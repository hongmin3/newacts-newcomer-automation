// Validates: REQ-ORGSETTINGS-002, REQ-ORGSETTINGS-004
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {load, spreadsheet} = require('./helpers/fake-sheets');

const targets = {formId: 'form', guideFileId: 'guide', guideTemplateId: 'template'};
const split = {term: '2027년 상반기', groups: [
  {key: '조', label: '보배군', teams: ['보배', '샘물']},
  {key: '길', label: '길군', teams: ['온유']},
]};
const original = {term: '2026년 하반기', groups: [
  {key: '조', label: '조군', teams: ['보배']},
  {key: '명', label: '명군', teams: ['열매']},
]};

function options(values, pageId) {
  return values.map(value => ({value, goToSectionId: pageId}));
}
function page(itemId, title) {
  return {itemId, title, pageBreakItem: {}};
}
function choice(itemId, title, values) {
  return {itemId, title, questionItem: {question: {
    questionId: 'question-' + itemId, required: true,
    choiceQuestion: {type: 'RADIO', options: values}
  }}};
}
function readOptions(item) {
  return item.questionItem.question.choiceQuestion.options;
}
function digest(algorithm, bytes) {
  return [...crypto.createHash(algorithm).update(Buffer.from(bytes)).digest()];
}
function assetsFixture() {
  const h = load('attendance-webapp/OrgAssets.gs');
  const data = {formId: 'form', linkedSheetId: 'linked', responderUri: 'https://forms.example/initial',
    revisionId: 'initial', items: [
      {itemId: 'applicant', title: '신청자 이름'},
      choice('group', '군', [
        {value: '조군', goToSectionId: 'jo-page'},
        {value: '명군', goToSectionId: 'myung-page'}
      ]),
      page('jo-page', '조군 - 팀 선택'),
      choice('jo-team', '팀', options(['보배'], 'final-page')),
      page('myung-page', '명군 - 팀 선택'),
      choice('myung-team', '팀', options(['열매'], 'final-page')),
      page('final-page', '참석자 정보 입력'),
      {itemId: 'phone', title: '집중교육 참석자 전화번호'}
    ]};
  const state = {accepting: true, formWrites: 0, guideWrites: 0, dropNextFormResponse: false};
  const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 6, 64, 0, 0, 3, 32];
  const guide = {id: 'guide', mimeType: 'image/png', md5Checksum: 'before',
    headRevisionId: 'before', capabilities: {canModifyContent: true}};
  const blob = {getBytes: () => png, getContentType: () => 'image/png',
    setContentType(type) {assert.equal(type, 'image/png'); return this;},
    setName(name) {assert.equal(name, '층별안내도.png'); return this;}};
  function response(content) {
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify(content)};
  }
  h.context.FormApp = {openById(id) {
    assert.equal(id, 'form');
    return {isAcceptingResponses: () => state.accepting,
      setAcceptingResponses(value) {state.accepting = value;}};
  }};
  h.context.ScriptApp = {getOAuthToken: () => 'test-token'};
  Object.assign(h.context.Utilities, {DigestAlgorithm: {MD5: 'md5', SHA_256: 'sha256'},
    Charset: {UTF_8: 'UTF-8'}, computeDigest: digest});
  h.context.UrlFetchApp = {fetch(url, request) {
    if (url.includes('forms.googleapis.com') && request.method === 'get') {
      return response(data);
    }
    if (url.endsWith('/form:batchUpdate')) {
      const batch = JSON.parse(request.payload);
      assert.equal(batch.writeControl.requiredRevisionId, data.revisionId);
      for (const entry of batch.requests) {
        assert.ok(!entry.deleteItem && !entry.moveItem);
        if (entry.createItem) {
          const {location, item} = entry.createItem;
          data.items.splice(location.index, 0, item);
        } else {
          const {location, item, updateMask} = entry.updateItem;
          const current = data.items[location.index];
          assert.equal(current.itemId, item.itemId);
          if (updateMask === 'title') current.title = item.title;
          else {
            assert.equal(updateMask, 'questionItem.question.choiceQuestion.options');
            current.questionItem.question.choiceQuestion.options = readOptions(item);
          }
        }
      }
      state.formWrites++;
      data.revisionId = 'batch-' + state.formWrites;
      if (state.dropNextFormResponse) {
        state.dropNextFormResponse = false;
        throw new Error('연결 중단');
      }
      return response({});
    }
    if (url.includes('/drive/v3/files/form?')) {
      return response({id: 'form', mimeType: 'application/vnd.google-apps.form',
        capabilities: {canEdit: true}});
    }
    if (url.includes('/drive/v3/files/template?')) {
      return response({id: 'template', mimeType: 'application/vnd.google-apps.presentation',
        capabilities: {canCopy: true}});
    }
    if (url.includes('/upload/drive/v3/files/guide?')) {
      assert.equal(request.method, 'patch');
      assert.match(url, /uploadType=media/);
      assert.deepEqual(request.payload, png);
      guide.headRevisionId = 'revision-' + ++state.guideWrites;
      guide.md5Checksum = Buffer.from(digest('md5', png)).toString('hex');
      return response(guide);
    }
    if (url.includes('/drive/v3/files/guide?')) return response(guide);
    if (url.includes('slides.googleapis.com')) {
      assert.match(url, /slides.googleapis.com\/v1\/presentations\/temporary\/pages\/preserved-map\/thumbnail/);
      assert.match(url, /thumbnailProperties.thumbnailSize=LARGE/);
      return response({contentUrl: 'https://preview.example/image'});
    }
    if (url === 'https://preview.example/image') return {getBlob: () => blob};
    throw new Error('예상치 못한 요청 ' + url);
  }};
  return {...h, data, state, guide, png, blob};
}

{
  const {context, data, state} = assetsFixture();
  assert.throws(() => context.orgUpdateForm_(split, targets), /접수/);
  assert.equal(context.orgFormAccepting_(targets), true);
  context.orgSetFormAccepting_(targets, false);
  state.dropNextFormResponse = true;
  assert.throws(() => context.orgUpdateForm_(split, targets), /연결 중단/);
  context.orgUpdateForm_(split, targets);
  assert.equal(state.formWrites, 1, '응답이 끊긴 실행을 재개해도 문항을 추가하지 않는다');
  const group = data.items.find(item => item.itemId === 'group');
  assert.deepEqual(readOptions(group).map(option => option.value), ['보배군', '길군']);
  assert.equal(readOptions(group)[0].goToSectionId, 'jo-page');
  const existing = data.items.find(item => item.itemId === 'jo-team');
  assert.equal(existing.questionItem.question.questionId, 'question-jo-team');
  assert.deepEqual(readOptions(existing), options(['보배', '샘물'], 'final-page'));
  const newPageIndex = data.items.findIndex(item => item.itemId === readOptions(group)[1].goToSectionId);
  assert.deepEqual(readOptions(data.items[newPageIndex + 1]), options(['온유'], 'final-page'));
  assert.equal(data.items.find(item => item.itemId === 'myung-team').title, '팀');
  assert.equal(data.items.find(item => item.itemId === 'phone').title, '집중교육 참석자 전화번호');
  assert.equal(data.linkedSheetId, 'linked');
  assert.equal(data.responderUri, 'https://forms.example/initial');
  assert.equal(context.orgFormAccepting_(targets), false);
  context.orgUpdateForm_(original, targets);
  assert.deepEqual(readOptions(group), [
    {value: '조군', goToSectionId: 'jo-page'}, {value: '명군', goToSectionId: 'myung-page'}
  ]);
  context.orgSetFormAccepting_(targets, true);
  assert.equal(context.orgFormAccepting_(targets), true);
}

{
  const {context, data} = assetsFixture();
  const renamed = {groups: [{id: 'same-group', key: '배', label: '보배군',
    aliases: ['조', '조군'], teams: ['보배']}]};
  context.orgSetFormAccepting_(targets, false);
  context.orgUpdateForm_(renamed, targets);
  assert.equal(readOptions(data.items.find(item => item.itemId === 'group'))[0].goToSectionId, 'jo-page');
  context.orgUpdateForm_({groups: [{...renamed.groups[0], key: '새', label: '새군', aliases: []}]}, targets);
  assert.equal(readOptions(data.items.find(item => item.itemId === 'group'))[0].goToSectionId, 'jo-page');
  assert.equal(data.items.find(item => item.itemId === 'jo-team').questionItem.question.questionId, 'question-jo-team');
  assert.equal(data.items.length, 8, '군 표시 이름과 약칭을 함께 바꿔도 기존 응답 문항을 사용한다');
}

{
  const {context, data, state} = assetsFixture();
  data.items.find(item => item.itemId === 'final-page').title = '다른 정보';
  context.orgSetFormAccepting_(targets, false);
  assert.throws(() => context.orgUpdateForm_(split, targets), /참석자 정보 입력/);
  assert.equal(state.formWrites, 0);
}

{
  const {context, state, blob, guide} = assetsFixture();
  context.orgUpdateGuide_(blob, targets);
  context.orgUpdateGuide_(blob, targets);
  assert.equal(state.guideWrites, 1, '같은 파일 본문으로 새 버전을 중복 업로드하지 않는다');
  assert.equal(guide.id, 'guide');
  assert.throws(() => context.orgUpdateGuide_({...blob, getBytes: () => [1]}, targets), /PNG/);
}

{
  const {context, state, blob} = assetsFixture();
  const drawn = [];
  let templateTouched = false;
  let saved = false;
  let trashed = false;
  const rootFolder = {};
  const originalMarker = {getTitle: () => 'ORG_TEAM_PANEL', getDescription: () => '',
    getLeft: () => 350, getTop: () => 55, getWidth: () => 240, getHeight: () => 150,
    getRotation: () => 0, remove() {templateTouched = true;}};
  const copyMarker = {...originalMarker, remove() {drawn.push({remove: 'marker'});}};
  const font = Object.fromEntries(['setFontFamily', 'setFontSize', 'setForegroundColor', 'setBold']
    .map(method => [method, () => font]));
  const paragraph = Object.fromEntries(['setParagraphAlignment', 'setLineSpacing', 'setSpaceAbove', 'setSpaceBelow']
    .map(method => [method, () => paragraph]));
  const shape = {setContentAlignment() {}, getText: () => ({
    getTextStyle: () => font, getParagraphStyle: () => paragraph
  })};
  const sourceSlide = {getShapes: () => [originalMarker]};
  const renderSlide = {getShapes: () => [copyMarker], getObjectId: () => 'preserved-map',
    insertShape(type, left, top, width, height) {
      drawn.push({type, left, top, width, height});
      return {getFill: () => ({setSolidFill() {}}), getBorder: () => ({setTransparent() {}})};
    },
    insertTextBox(text, left, top, width, height) {
      drawn.push({text, left, top, width, height});
      return shape;
    }
  };
  context.SlidesApp = {ShapeType: {RECTANGLE: 'rect'}, ContentAlignment: {MIDDLE: 'middle'},
    ParagraphAlignment: {CENTER: 'center', START: 'start'}, openById(id) {
      return {getPageWidth: () => 600, getPageHeight: () => 300,
        getSlides: () => [id === 'template' ? sourceSlide : renderSlide], saveAndClose() {saved = true;}};
    }};
  context.DriveApp = {getRootFolder: () => rootFolder, getFileById(id) {
    if (id === 'guide') return {getBlob: () => blob};
    return {makeCopy(name, folder) {
      assert.equal(id, 'template');
      assert.equal(folder, rootFolder);
      return {getId: () => 'temporary', setTrashed(value) {trashed = value;}};
    }};
  }};
  context.orgCheckAssets_(targets);
  assert.equal(state.accepting, true, '미리보기는 접수를 일시 중지하지 않는다');
  assert.equal(context.orgRenderGuide_(split, targets), blob);
  assert.equal(templateTouched, false);
  assert.equal(saved, true);
  assert.equal(trashed, true);
  assert.equal(state.guideWrites, 0, 'PNG 렌더링만으로 운영 안내도를 덮지 않는다');
  assert.deepEqual(drawn.filter(item => item.text).map(item => item.text),
    ['군', '팀', '보배군', '보배 · 샘물', '길군', '온유']);
  assert.ok(drawn.slice(1).every(item => item.left >= 350 && item.left + item.width <= 590.01 &&
    item.top >= 55 && item.top + item.height <= 205.01), '안내도 표 마커 밖을 변경하지 않는다');
  const crowded = {groups: Array.from({length: 40}, (_, i) => ({label: '군' + i, teams: ['팀']}))};
  assert.throws(() => context.orgRenderGuide_(crowded, targets), /표 영역이 작습니다/);
}

{
  const h = load('intensive-training-application/Code.gs');
  const config = h.evaluate('CONFIG');
  const cutoff = new Date('2026-11-22T00:00:00Z');
  const submitted = [
    [new Date(cutoff.getTime() - 1000), '신청인', '조군', '보배', '', '이전 참석', '01012345678'],
    [new Date(cutoff.getTime()), '신청인', '길군', '', '온유', '새 참석', '01012345679'],
    [new Date(cutoff.getTime() + 1000), '신청인', '보배군', '', '온유', '분기 오류', '01012345670']
  ];
  const admin = spreadsheet('admin', {
    [config.ADMIN_VIEW_SHEET_NAME]: [Array(9).fill('header')],
    responses: [['시각', '신청자 이름', '군', '팀', '팀', '집중교육 참석자 이름', '집중교육 참석자 전화번호'],
      ...submitted]
  });
  const pub = spreadsheet('public', {[config.PUBLIC_SHEET_NAME]: [Array(5).fill('header')]});
  h.properties.set('ADMIN_SS_ID', 'admin');
  h.properties.set('PUBLIC_SS_ID', 'public');
  h.context.SpreadsheetApp.openById = id => id === 'admin' ? admin : pub;
  h.context.readOrgConfiguration_ = at => !at || Number(at) >= Number(cutoff) ? split : original;
  h.context.findOrgGroup_ = (configuration, value) =>
    configuration.groups.find(group => group.key === value || group.label === value);
  const raw = admin.getSheetByName('responses');
  [1, 0, 2].forEach(i => h.context.onFormSubmitHandler({
    range: raw.getRange(i + 2, 1), values: submitted[i]
  }));
  assert.deepEqual(raw.rows.slice(1).map(row => row[2]), ['조군', '길군', '보배군']);
  const actual = admin.getSheetByName(config.ADMIN_VIEW_SHEET_NAME).rows.slice(1);
  assert.deepEqual(actual.map(row => [row[1], row[8]]), [
    ['길', '정상'], ['조', '정상'], ['조', '군/팀 오류']
  ]);
  assert.deepEqual(pub.getSheetByName(config.PUBLIC_SHEET_NAME).rows.slice(1).map(row => row[1]), ['조', '길']);
  const renamed = {groups: [{...split.groups[0], key: '배', aliases: ['조']}, split.groups[1]]};
  h.context.readOrgConfiguration_ = () => renamed;
  h.context.findOrgGroup_ = (configuration, value) =>
    configuration.groups.find(group => [group.key, group.label, ...(group.aliases || [])].includes(value));
  h.context.resortPublicSheet(pub.getSheetByName(config.PUBLIC_SHEET_NAME));
  assert.deepEqual(pub.getSheetByName(config.PUBLIC_SHEET_NAME).rows.slice(1).map(row => row[1]), ['조', '길'],
    '이전 약칭의 신청 행도 같은 군에 배치한다');
}
console.log('org-assets tests passed');
