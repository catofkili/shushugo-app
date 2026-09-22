/*
 * 收藏页：数据层是网页同一份 favorites-api（src/shared/web.js）。
 * 夹子的身份是名字（同步表不许用自增 id）；删夹子不删收藏，里面的东西回到未分类；
 * 未分类（folder = ''）删不掉也改不了名，收藏永远有个去处。
 */
const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const features = require('../../runtime/extended-features');

Page({
  data: { ready: false, error: '', type: 'all', folder: 'all', folders: [], folderNames: [], unfiled: 0, items: [], newFolder: '', renaming: '', renameTo: '' },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true });
      this.load();
    } catch (error) {
      console.error('[favorites] 读取失败', error);
      this.setData({ error: '先到「单词」下载离线词库。' });
    }
  },

  load() {
    const folders = features.listFavoriteFolders();
    const items = features.listFavorites(this.data.type, this.data.folder).map((item) => ({ ...item, typeLabel: item.type === 'word' ? '单词' : '语法', folderLabel: item.folder || '未分类' }));
    this.setData({ folders, folderNames: folders.map((folder) => folder.name), unfiled: features.unfiledFavoriteCount(), items });
  },

  pickType(event) { this.setData({ type: event.currentTarget.dataset.value }, () => this.load()); },
  pickFolder(event) { this.setData({ folder: event.currentTarget.dataset.value }, () => this.load()); },
  folderInput(event) { this.setData({ newFolder: event.detail.value }); },

  async createFolder() {
    const name = await features.createFavoriteFolder(this.data.newFolder);
    if (name) { this.setData({ newFolder: '', folder: name }); this.load(); }
  },

  startRename(event) { const name = event.currentTarget.dataset.name; this.setData({ renaming: name, renameTo: name }); },
  renameInput(event) { this.setData({ renameTo: event.detail.value }); },
  async confirmRename() {
    const from = this.data.renaming;
    const to = await features.renameFavoriteFolder(from, this.data.renameTo);
    this.setData({ renaming: '', renameTo: '', folder: this.data.folder === from && to ? to : this.data.folder });
    this.load();
  },
  cancelRename() { this.setData({ renaming: '', renameTo: '' }); },

  deleteFolder(event) {
    const name = event.currentTarget.dataset.name;
    wx.showModal({
      title: `删除「${name}」？`,
      content: '夹子里的收藏不会删，回到未分类。',
      success: async ({ confirm }) => {
        if (!confirm) return;
        await features.deleteFavoriteFolder(name);
        this.setData({ folder: this.data.folder === name ? 'all' : this.data.folder });
        this.load();
      }
    });
  },

  async move(event) {
    const index = Number(event.detail.value);
    const { type, id } = event.currentTarget.dataset;
    await features.moveFavorite(type, id, index ? this.data.folderNames[index - 1] : '');
    this.load();
  },

  async remove(event) {
    const { type, id } = event.currentTarget.dataset;
    await features.toggleFavorite(type, id);
    this.load();
  }
});
