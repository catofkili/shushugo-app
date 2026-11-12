import { save } from './common.mjs';
// The first two compare the brake to a fixed exam-completion quota; the third preserves old due dates.
save('shortlist.json',[
 {schedule:'P1a',newKind:'accuracy',threshold:.65,low:5,leech:8,intake:5},
 {schedule:'P1a',newKind:'fixed',newValue:10,leech:8,intake:5},
 {schedule:'P1b',newKind:'accuracy',threshold:.65,low:5,leech:8,intake:5}
]);
console.log('SHORTLIST OK: three candidate configurations');
