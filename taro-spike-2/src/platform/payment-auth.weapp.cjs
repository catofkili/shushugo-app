const TOKEN_KEY = 'mn_cloud_sync_token';

function authHeaders() {
  const token = typeof localStorage === 'undefined' ? '' : localStorage.getItem(TOKEN_KEY) || '';
  return token ? { authorization: `Bearer ${token}` } : {};
}

module.exports = { authHeaders };
