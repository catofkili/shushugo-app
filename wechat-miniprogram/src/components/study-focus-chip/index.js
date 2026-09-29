const { web } = require('../../core/study-core');

Component({
  properties: {
    active: { type: Boolean, value: false }
  },

  data: {
    time: '10:00',
    rewardText: '+100 柚子'
  },

  lifetimes: {
    attached() {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), 1000);
    },
    detached() {
      if (this.timer) clearInterval(this.timer);
    }
  },

  observers: {
    active() { this.refresh(); }
  },

  methods: {
    refresh() {
      if (!this.data.active) return;
      const snapshot = web.studyFocus.getStudyFocusSnapshot();
      if (snapshot.status !== 'running') return;
      const seconds = snapshot.remainingSeconds;
      const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
      const remainder = (seconds % 60).toString().padStart(2, '0');
      const rewardText = snapshot.nextReward > 0 ? `+${snapshot.nextReward} 柚子` : '今日奖励已领完';
      if (this.data.time !== `${minutes}:${remainder}` || this.data.rewardText !== rewardText) {
        this.setData({ time: `${minutes}:${remainder}`, rewardText });
      }
    }
  }
});
