const config = require('../config');
const { authHeaders } = require('./auth');
const { requestJson } = require('./wx-promise');

function api(path) {
  const base = String(config.syncUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('没有配置 syncUrl');
  return `${/\/api$/i.test(base) ? base : `${base}/api`}${path}`;
}

function request(path, method = 'GET', data) {
  return requestJson(api(path), {
    method,
    data,
    header: { 'content-type': 'application/json', ...authHeaders() }
  });
}

async function myTeam(studyDay) {
  return (await request(`/teams/me?day=${encodeURIComponent(studyDay)}`)).team || null;
}

async function plaza(studyDay) {
  return (await request(`/teams/plaza?day=${encodeURIComponent(studyDay)}`)).teams || [];
}

async function create(input) {
  return (await request('/teams', 'POST', input)).team;
}

async function join(input) {
  return (await request('/teams/join', 'POST', input)).team;
}

async function update(input) {
  return (await request('/teams/me', 'PUT', input)).team;
}

async function reportActivity(input) {
  return (await request('/teams/activity', 'POST', input)).team;
}

async function cheer(memberId, studyDay) {
  return (await request('/teams/cheers', 'POST', { memberId, studyDay })).team;
}

async function leave() {
  return request('/teams/leave', 'POST');
}

async function regenerateInvite() {
  return (await request('/teams/invite/regenerate', 'POST')).inviteCode;
}

async function report(teamId, reason) {
  return request('/teams/report', 'POST', { teamId, reason });
}

module.exports = { cheer, create, join, leave, myTeam, plaza, regenerateInvite, report, reportActivity, update };
