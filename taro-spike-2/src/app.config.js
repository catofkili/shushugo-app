const { ROUTE_TABLE: routeTable } = require('./platform/route-table.cjs');
const mainRoutes = routeTable.filter((route) => route.tab);
const groupedRoutes = (subpackage) => routeTable
  .filter((route) => route.subpackage === subpackage)
  .map((route) => route.path.slice(`${subpackage}/`.length));

export default {
  pages: mainRoutes.map((route) => route.path),
  tabBar: {
    color: '#81796D',
    selectedColor: '#4F7A3A',
    backgroundColor: '#FBF8F1',
    borderStyle: 'white',
    list: mainRoutes.map((route) => ({
      pagePath: route.path,
      text: ({ home: '主页', word: '单词', grammar: '语法', profile: '我的' })[route.page],
      iconPath: `assets/tabs/${route.page}.png`,
      selectedIconPath: `assets/tabs/${route.page}.png`
    }))
  },
  subPackages: [
    { root: 'study', pages: groupedRoutes('study') },
    { root: 'account', pages: ['login/index', ...groupedRoutes('account')] },
    { root: 'content-pages', pages: groupedRoutes('content-pages') },
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
