Page({
  data: {
    modes: [
      { title: '经典模式', detail: '按今日计划：先复习，再进入新词', url: '/pages/index/index?mode=classic', tone: 'blue' },
      { title: '快速学习', detail: '独立的 12 张小队列，不改经典计划顺序', url: '/pages/index/index?mode=quick', tone: 'green' },
      { title: '错题本', detail: '只从本地作答流水里找出忘记／模糊过的词', url: '/pages/index/index?mode=mistakes', tone: 'red' },
      { title: '反向回忆', detail: '中文 → 日语；使用独立 reverse FSRS 记忆', url: '/pages/index/index?direction=reverse', tone: 'purple' },
      { title: '汉字读音', detail: '表记 → 读音，只遮需要回忆的汉字读法', url: '/pages/index/index?direction=kanji', tone: 'orange' },
      { title: '自选清单', detail: '先在词库筛选并选词；批量操作和详情都保存在本地', url: '/pages/library/index', tone: 'gray' }
    ]
  }
});
