// Only first answers on a later study day enter this history; same-day retries cannot forgive a word.
export function observeFirst(state, lapses, grade=null) {
  state.recentFirst??=[];
  if(grade!==null) {
    state.recentFirst.push(grade);
    if(state.recentFirst.length>10)state.recentFirst.shift();
  }
  if(lapses<8)return;
  if(state.f1Released&&grade===1) {
    state.f1Failures=(state.f1Failures??0)+1;
    if(state.f1Failures>=2)state.f1Released=false;
  }
  if(!state.f1Released&&state.recentFirst.length>=2&&state.recentFirst.slice(-2).every(g=>g>=3)) {
    state.f1Released=true;state.f1Failures=0;
  }
}
export function inPool(word,gate) {
  if(gate==='L8/10')return word.card.lapses>=8;
  if(gate==='F1')return word.card.lapses>=8&&!word.f1Released;
  if(gate==='F2')return (word.recentFirst??[]).filter(g=>g===1).length>=5;
  return false;
}
