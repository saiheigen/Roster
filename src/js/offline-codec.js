
'use strict';
const RosterOfflineCodec = (() => {
function offlineAssignments(result,src,people){
 if(!['FEASIBLE','OPTIMAL'].includes(result?.status))throw Error('未取得可行解（'+(result?.status||'無狀態')+'）');
 if(!Array.isArray(result.assignments)||result.assignments.length!==src.tasks.length)throw Error('班次數量不符');
 return result.assignments.map((i,j)=>{
  if(i===-1)return null;
  if(!Number.isInteger(i)||!src.people[i]?.allowed.includes(j))throw Error('回傳人員資格不符');
  return people[i].id;
 });
}
  return Object.freeze({offlineAssignments});
})();
