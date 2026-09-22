const confusion = require('../../runtime/confusion');
const { getDatabase } = require('../../runtime/database-store');
Page({
  data: { state: 'intro', available: 0, questions: [], index: 0, question: {}, selected: 0, revealed: false, correct: 0 },
  onShow() { this.setData({ available: confusion.allGroups(getDatabase()).length }); },
  start() {
    const groups = [...confusion.allGroups(getDatabase())].sort(() => Math.random() - 0.5).slice(0, 10);
    const questions = groups.map((group) => { const answer = group.members[Math.floor(Math.random() * group.members.length)]; return { key: group.key, typeName: confusion.TYPE_META[group.type]?.name || group.type, hint: confusion.TYPE_META[group.type]?.hint || '', prompt: answer.meaning, answerId: answer.id, options: group.members.map((member) => ({ id: member.id, form: member.kanji || member.kana, kana: member.kana })) }; });
    this.setData({ state: 'quiz', questions, index: 0, question: questions[0], selected: 0, revealed: false, correct: 0 });
  },
  answer(event) { if (this.data.revealed) return; const selected = Number(event.currentTarget.dataset.id); this.setData({ selected, revealed: true, correct: this.data.correct + (selected === this.data.question.answerId ? 1 : 0) }); },
  async next() { if (this.data.selected === this.data.question.answerId) await confusion.setConfusionMastered(this.data.question.key, true); const index = this.data.index + 1; if (index >= this.data.questions.length) { this.setData({ state: 'result' }); return; } this.setData({ index, question: this.data.questions[index], selected: 0, revealed: false }); }
});
