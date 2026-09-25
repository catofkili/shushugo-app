export default {
  pages: ['pages/index/index'],
  subPackages: [
    { root: 'quiz', pages: ['vocab-test/index'] },
    { root: 'study', pages: ['word-study/index'] },
    { root: 'features', pages: ['placeholder/index'] },
    { root: 'content', pages: ['placeholder/index'] },
    { root: 'grammar-foundation', pages: ['placeholder/index'] },
    { root: 'grammar-advanced', pages: ['placeholder/index'] },
    { root: 'grammar-pages', pages: ['compile/index'] }
  ],
  window: {
    navigationBarTitleText: 'ShuShuGo · 路线 A 试验',
    navigationBarBackgroundColor: '#FBF6EC',
    navigationBarTextStyle: 'black',
    backgroundColor: '#FBF6EC'
  }
};
