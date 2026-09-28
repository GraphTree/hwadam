/* Data, CSV contracts, graph validation, and deterministic demo execution. No network. */
(function (root) {
const clone = x => JSON.parse(JSON.stringify(x));
const uid = p => p + '-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0,8);
const day = (date,n) => new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
const operations = [
 {id:'read',name:'CSV 읽기',desc:'입력 아티팩트의 표 데이터를 읽습니다.',input:'CSV',output:'RawTable',icon:'file'},
 {id:'normalize',name:'시계열 정규화',desc:'매핑된 열을 날짜·시계열·수량으로 변환합니다.',input:'RawTable',output:'TimeSeriesTable',icon:'sliders'},
 {id:'smooth',name:'이동 평균 변환',desc:'각 시계열에 7일 이동 평균을 적용합니다.',input:'TimeSeriesTable',output:'TimeSeriesTable',icon:'wave'},
 {id:'forecast',name:'수요 예측',desc:'기간과 기준 모델로 미래 수요를 계산합니다.',input:'TimeSeriesTable',output:'ForecastTable',icon:'spark'},
 {id:'export',name:'결과 CSV 만들기',desc:'실행 ID와 모델 버전을 포함해 결과를 보관합니다.',input:'ForecastTable',output:'CSV',icon:'download'}
];
function sampleRows(){return Array.from({length:84},(_,i)=>['아메리카노','카페 라테','콜드 브루'].map((s,j)=>({date:day('2026-07-06',i),product:s,quantity:Math.round((180-j*48)+i*(0.48-j*.08)+[12,2,-9,4,24,62,48][i%7]+Math.sin(i*1.7+j)*13)}))).flat()}
const mapping = {timestamp:'date',series:'product',value:'quantity'};
function parseCSV(text){
 text=text.replace(/^\uFEFF/,''); let rows=[],row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){let c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
 if(c==='"'){if(field||closed)throw Error('따옴표 형식을 확인해 주세요.');quoted=true}
 else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[]}}
 else {if(closed)throw Error('닫는 따옴표 뒤에 쉼표가 필요합니다.');field+=c}}
 if(quoted)throw Error('닫히지 않은 따옴표가 있습니다.');row.push(field);if(row.some(v=>v!==''))rows.push(row);
 if(rows.length<2)throw Error('헤더와 데이터 행이 있는 CSV를 선택해 주세요.');const headers=rows.shift().map(x=>x.trim());
 if(headers.some(x=>!x)||new Set(headers).size!==headers.length)throw Error('열 이름이 비어 있거나 중복되어 있습니다.');
 if(rows.length>10000)throw Error('프로토타입에서는 최대 10,000행까지 등록할 수 있습니다.');
 return {headers,rows:rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`${i+2}행의 열 개수가 헤더와 다릅니다.`);return Object.fromEntries(headers.map((h,j)=>[h,r[j]]))})};
}
function normalize(rows,m){
 if(new Set(Object.values(m)).size!==3)throw Error('날짜, 시계열, 수량에 서로 다른 열을 선택해 주세요.');let seen=new Set();
 if(!rows.length)throw Error('CSV 데이터가 비어 있습니다.');
 const out=rows.map((r,i)=>{const timestamp=String(r[m.timestamp]??'').trim(),series=String(r[m.series]??'').trim(),raw=String(r[m.value]??'').trim(),value=Number(raw);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(timestamp)||!Number.isFinite(Date.parse(timestamp))||new Date(timestamp).toISOString().slice(0,10)!==timestamp)throw Error(`${i+2}행: 날짜는 유효한 YYYY-MM-DD 형식이어야 합니다.`);
 if(!series||!raw||!Number.isFinite(value)||value<0)throw Error(`${i+2}행: 시계열 이름과 0 이상의 수량을 확인해 주세요.`);
 const key=JSON.stringify([series,timestamp]);if(seen.has(key))throw Error(`${i+2}행: 같은 시계열에 날짜가 중복되어 있습니다.`);seen.add(key);return {series_id:series,timestamp,value}}).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 for(const s of new Set(out.map(r=>r.series_id))){const group=out.filter(r=>r.series_id===s);if(group.length<7)throw Error(`${s}: 최소 7일의 관측값이 필요합니다.`);for(let i=1;i<group.length;i++)if(day(group[i-1].timestamp,1)!==group[i].timestamp)throw Error(`${s}: 누락된 날짜가 있습니다. 일 단위 연속 데이터를 사용해 주세요.`)}
 const ends=[...new Set(out.map(r=>r.series_id))].map(s=>out.filter(r=>r.series_id===s).at(-1).timestamp);
 if(new Set(ends).size>1)throw Error('메뉴별 예측을 같은 날짜부터 비교하려면 모든 시계열의 마지막 날짜가 같아야 합니다.');
 return out;
}
function validate(c){let type='CSV';const errors=[];if(new Set(c.nodes).size!==c.nodes.length)errors.push('이 프로토타입에서는 같은 오퍼레이션을 한 번씩 배치해 주세요.');if(!c.nodes.length)errors.push('오퍼레이션 노드를 추가해 주세요.');c.nodes.forEach((id,i)=>{const op=operations.find(x=>x.id===id);if(!op){errors.push(`${i+1}번: 알 수 없는 노드`);return}if(type!==op.input)errors.push(`${op.name}: ${op.input} 입력이 필요하지만 ${type}이 연결되어 있습니다.`);type=op.output});if(!c.nodes.includes('forecast')||!c.nodes.includes('export'))errors.push('수요 예측과 결과 CSV 노드가 필요합니다.');if(type!=='CSV')errors.push('최종 출력은 CSV여야 합니다.');return errors}
function forecast(rows,params,runId,nodes){
 let normalized=clone(rows);if(params.range!=='all'){const cutoff=day(normalized.at(-1).timestamp,-Number(params.range)+1);normalized=normalized.filter(r=>r.timestamp>=cutoff)}
 if(nodes.includes('smooth'))normalized=normalized.map(r=>{const prev=normalized.filter(p=>p.series_id===r.series_id&&p.timestamp<=r.timestamp).slice(-7);return {...r,value:prev.reduce((a,p)=>a+p.value,0)/prev.length}});
 return [...new Set(normalized.map(r=>r.series_id))].flatMap(series=>{const a=normalized.filter(r=>r.series_id===series),last=a.at(-1);return Array.from({length:Number(params.horizon)},(_,i)=>({series_id:series,forecast_timestamp:day(last.timestamp,i+1),forecast_value:Math.round(params.model==='seasonal'?a[a.length-7+i%7].value:last.value),model_version:params.model+'@1.0',run_id:runId}))});
}
function execute(state,comp,params){
 if(![7,14,28].includes(Number(params.horizon))||!['last','seasonal'].includes(params.model)||!['all','28','56'].includes(String(params.range)))throw Error('지원하지 않는 예측 설정입니다.');
 const errors=validate(comp);if(errors.length)throw Error(errors.join('\n'));const input=state.artifacts.find(a=>a.id===comp.input);if(!input||input.kind!=='input')throw Error('입력 CSV를 연결해 주세요.');
 const normalized=normalize(input.rows,input.mapping);const runId=uid('run'),id=uid('artifact');const output=forecast(normalized,params,runId,comp.nodes);
 const artifact={id,name:comp.name+' · 예측 결과.csv',kind:'output',rows:output,run:runId,input:input.id,comp:comp.id,created:new Date().toISOString(),params:clone(params)};
 const run={id:runId,comp:comp.id,version:comp.version,input:input.id,output:id,params:clone(params),nodes:clone(comp.nodes),created:artifact.created,status:'SUCCEEDED'};
 state.artifacts.unshift(artifact);state.runs.unshift(run);let entity=state.entities.find(e=>e.comp===comp.id);if(!entity){entity={id:uid('entity'),name:comp.name+' 결과',kind:'ForecastTable',desc:'컴포지션의 예측 결과를 참조하는 엔티티',comp:comp.id,artifacts:[]};state.entities.push(entity)}entity.artifacts.unshift(id);return artifact;
}
function publish(state,c){const errors=validate(c);if(errors.length)throw Error(errors.join('\n'));c.version++;c.published=true;c.dirty=false;const snapshot=clone(c);const a={id:uid('artifact'),name:c.name+` · v${c.version}.json`,kind:'composition',comp:c.id,snapshot,created:new Date().toISOString()};state.artifacts.unshift(a);return a}
function seed(){
 const input={id:'input-demo',name:'성수점_일별판매_2026Q3.csv',kind:'input',rows:sampleRows(),mapping:clone(mapping),created:'2026-09-27T00:00:00Z'};
 const c={id:'comp-demand',name:'일별 수요 예측',desc:'판매 이력을 정리하고, 다음 주의 수요를 예측합니다.',input:input.id,nodes:['read','normalize','forecast','export'],params:{horizon:14,model:'seasonal',range:'all'},version:0,published:false};
 const state={artifacts:[input],compositions:[c],entities:[{id:'entity-sales',name:'성수점 판매 데이터',kind:'TimeSeriesTable',desc:'3개 메뉴의 일별 판매 수량 · 일 단위',artifacts:[input.id]}],apps:[],runs:[]};
 publish(state,c);const out=execute(state,c,c.params);state.apps.push({id:'app-demand',name:'수요 예측 대시보드',desc:'다가올 수요를 살펴보고, 더 나은 발주를 준비하세요.',comp:c.id,artifact:out.id,params:clone(c.params)});return state;
}
function csv(rows){if(!rows.length)return '';const keys=Object.keys(rows[0]);const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';return '\uFEFF'+[keys,...rows.map(r=>keys.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n')}
const api={clone,uid,day,operations,sampleRows,mapping,parseCSV,normalize,validate,forecast,execute,publish,seed,csv};root.Hwadam=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
