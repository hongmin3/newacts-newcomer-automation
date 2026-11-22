// Keep this reader identical in all four Apps Script projects.
const ORG_SETTINGS_PROPERTY = 'ORG_SETTINGS_SPREADSHEET_ID';
const ORG_VERSIONS_SHEET = '_군팀_적용이력';
let orgVersionCache_;

function readOrgVersions_() {
  const id = PropertiesService.getScriptProperties().getProperty(ORG_SETTINGS_PROPERTY);
  if (!id) return [];
  if (orgVersionCache_ && orgVersionCache_.id === id) return orgVersionCache_.versions;

  const sheet = SpreadsheetApp.openById(id).getSheetByName(ORG_VERSIONS_SHEET);
  if (!sheet) throw new Error('군·팀 적용 이력 탭을 확인해 주세요.');
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 4).getValues();
  const versions = rows.map(function ([versionId, appliedAt, term, serialized]) {
    const date = new Date(appliedAt);
    let config;
    try { config = JSON.parse(serialized); }
    catch (_) { throw new Error('군·팀 적용 이력의 형식을 확인해 주세요.'); }
    if (!versionId || !Number.isFinite(date.getTime()) || !config || config.id !== versionId ||
        config.term !== Number(term) || !Array.isArray(config.groups) || !config.groups.length) {
      throw new Error('군·팀 적용 이력의 형식이 올바르지 않습니다.');
    }
    return Object.assign({}, config, {effectiveAt: date.toISOString()});
  });
  orgVersionCache_ = {id: id, versions: versions};
  return versions;
}

function readOrgConfiguration_(at) {
  const cutoff = at === undefined ? Date.now() : new Date(at).getTime();
  if (!Number.isFinite(cutoff)) throw new Error('군·팀 배치의 기준 날짜를 확인해 주세요.');
  const versions = readOrgVersions_();
  for (let index = versions.length - 1; index >= 0; index--) {
    if (new Date(versions[index].effectiveAt).getTime() <= cutoff) return versions[index];
  }
  return null;
}

function findOrgGroup_(config, value) {
  if (!config) return null;
  const name = String(value || '').trim();
  return config.groups.find(function (group) {
    return group.key === name || group.label === name || (group.aliases || []).includes(name);
  }) || null;
}
