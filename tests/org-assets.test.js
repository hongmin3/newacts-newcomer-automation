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
    items: [
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
  const state = {accepting: true, formWrites: 0, guideWrites: 0, failAfter: '', added: 0};
  const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 6, 64, 0, 0, 3, 32];
  const guide = {id: 'guide', mimeType: 'image/png', md5Checksum: 'before',
    headRevisionId: 'before', capabilities: {canModifyContent: true}};
  const blob = {getBytes: () => png, getContentType: () => 'image/png',
    setContentType(type) {assert.equal(type, 'image/png'); return this;},
    setName(name) {assert.equal(name, '층별안내도.png'); return this;}};
  function write(action) {
    state.formWrites++;
    if (state.failAfter === action) {
      state.failAfter = '';
      throw new Error('연결 중단');
    }
  }
  function asItem(item) {
    const generic = {
      getId: () => item.itemId, getIndex: () => data.items.indexOf(item),
      getType: () => item.pageBreakItem ? 'PAGE_BREAK' :
        item.questionItem ? 'MULTIPLE_CHOICE' : 'TEXT',
      getTitle: () => item.title, getHelpText: () => item.helpText || '',
      setTitle(title) {item.title = title; write('title:' + item.itemId);}
    };
    const mc = {...generic, isRequired: () => Boolean(item.questionItem.question.required),
      setRequired(required) {item.questionItem.question.required = required; write('required:' + item.itemId);},
      getChoices: () => readOptions(item).map(option => ({
        getValue: () => option.value,
        getGotoPage: () => data.items.find(entry => entry.itemId === option.goToSectionId) ? {
          getId: () => option.goToSectionId
        } : null
      })),
      createChoice: (value, section) => ({value, goToSectionId: section.getId()}),
      setChoices(choices) {item.questionItem.question.choiceQuestion.options = Array.from(choices); write('choices:' + item.itemId);}
    };
    return {...generic, asPageBreakItem: () => generic, asMultipleChoiceItem: () => mc};
  }
  const findItem = id => data.items.find(item => item.itemId === id);
  h.context.FormApp = {
    ItemType: {PAGE_BREAK: 'PAGE_BREAK', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE', LIST: 'LIST'},
    DestinationType: {SPREADSHEET: 'SPREADSHEET'},
    openById(id) {
      assert.equal(id, 'form');
      return {
        getId: () => data.formId, getPublishedUrl: () => data.responderUri,
        getDestinationId: () => data.linkedSheetId, getDestinationType: () => 'SPREADSHEET',
        getTitle: () => '기존 신청', getDescription: () => '기존 안내',
        isAcceptingResponses: () => state.accepting,
        setAcceptingResponses(value) {state.accepting = value;},
        getItems: () => data.items.map(asItem),
        getItemById: itemId => findItem(itemId) ? asItem(findItem(itemId)) : null,
        addPageBreakItem() {
          const item = page('new-' + ++state.added, '');
          data.items.push(item); write('addPage');
          return asItem(item).asPageBreakItem();
        },
        addMultipleChoiceItem() {
          const item = choice('new-' + ++state.added, '', []);
          item.questionItem.question.required = false;
          data.items.push(item); write('addTeam');
          return asItem(item).asMultipleChoiceItem();
        },
        moveItem(from, to) {
          const [item] = data.items.splice(from, 1);
          assert.match(item.itemId, /^new-/, '기존 문항은 이동하지 않는다');
          data.items.splice(to, 0, item);
          write('move:' + item.itemId);
        }
      };
    }
  };
  Object.assign(h.context.Utilities, {DigestAlgorithm: {MD5: 'md5', SHA_256: 'sha256'},
    Charset: {UTF_8: 'UTF-8'}, computeDigest: digest});
  h.context.Drive = {Files: {
    get(id, request) {
      assert.equal(request.supportsAllDrives, true);
      if (id === 'form') return {id, mimeType: 'application/vnd.google-apps.form',
        capabilities: {canEdit: true}};
      if (id === 'template') return {id, version: 'template-1', mimeType: 'application/vnd.google-apps.presentation',
        capabilities: {canCopy: true}};
      assert.equal(id, 'guide');
      return {...guide};
    },
    update(metadata, id, media, request) {
      assert.equal(id, 'guide');
      assert.deepEqual(Object.keys(metadata), []);
      assert.equal(request.supportsAllDrives, true);
      assert.deepEqual(media.getBytes(), png);
      guide.headRevisionId = 'revision-' + ++state.guideWrites;
      guide.md5Checksum = Buffer.from(digest('md5', png)).toString('hex');
    }
  }};
  h.context.Slides = {Presentations: {Pages: {getThumbnail(presentation, slide, request) {
    assert.equal(presentation, 'temporary');
    assert.equal(slide, 'preserved-map');
    assert.equal(request['thumbnailProperties.mimeType'], 'PNG');
    assert.equal(request['thumbnailProperties.thumbnailSize'], 'LARGE');
    return {contentUrl: 'https://preview.example/image'};
  }}}};
  h.context.UrlFetchApp = {fetch(url) {
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
  context.orgUpdateForm_(split, targets);
  const writes = state.formWrites;
  context.orgUpdateForm_(split, targets);
  assert.equal(state.formWrites, writes, '같은 배치가 이미 적용되었으면 폼을 다시 쓰지 않는다');
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

for (const interrupted of ['title:jo-page', 'addPage', 'addTeam', 'move:new-2', 'move:new-1', 'choices:group']) {
  const {context, data, state, properties} = assetsFixture();
  const originalIds = data.items.map(item => item.itemId);
  context.orgSetFormAccepting_(targets, false);
  state.failAfter = interrupted;
  assert.throws(() => context.orgUpdateForm_(split, targets), /연결 중단/, interrupted);
  const persistedIds = data.items.map(item => item.itemId);
  assert.equal(context.orgFormAccepting_(targets), false);
  context.orgUpdateForm_(split, targets);
  assert.equal(state.added, 2, interrupted + ' 뒤 새 페이지와 팀 문항을 한 번씩만 추가한다');
  assert.deepEqual(data.items.map(item => item.itemId).filter(id => originalIds.includes(id)), originalIds);
  assert.ok(persistedIds.every(id => data.items.some(item => item.itemId === id)));
  assert.deepEqual(readOptions(data.items.find(item => item.itemId === 'group')), [
    {value: '보배군', goToSectionId: 'jo-page'}, {value: '길군', goToSectionId: 'new-1'}
  ]);
  assert.equal(properties.has('ORG_FORM_BRANCH_PENDING_form'), false);
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
  const {context, state, blob, data} = assetsFixture();
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
  const beforeFingerprint = context.orgCheckAssets_(targets);
  assert.equal(context.orgCheckAssets_(targets).form, beforeFingerprint.form);
  data.items.find(item => item.itemId === 'phone').title = '전화번호 변경';
  assert.notEqual(context.orgCheckAssets_(targets).form, beforeFingerprint.form);
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
