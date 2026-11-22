const ORG_GUIDE_PANEL = 'ORG_TEAM_PANEL';
const ORG_FORM_PAGE_SUFFIX = ' - 팀 선택';
const ORG_FORM_FINAL_PAGE = '참석자 정보 입력';
const ORG_FORM_OPTIONS_MASK = 'questionItem.question.choiceQuestion.options';

function orgCheckAssets_(targets) {
  const formFile = orgAssetFile_(targets.formId);
  if (formFile.mimeType !== 'application/vnd.google-apps.form' || !formFile.capabilities?.canEdit) {
    throw new Error('집중교육 폼을 편집할 권한을 확인하세요.');
  }
  const form = orgReadFormAsset_(targets);
  orgFormLayout_(form);

  const guide = orgCheckGuideFile_(targets);
  const template = orgAssetFile_(targets.guideTemplateId);
  if (template.mimeType !== 'application/vnd.google-apps.presentation' || !template.capabilities?.canCopy) {
    throw new Error('안내도 Google Slides 원본과 복사 권한을 확인하세요.');
  }
  const presentation = SlidesApp.openById(targets.guideTemplateId);
  orgGuidePanel_(presentation);
  const png = orgPngDimensions_(DriveApp.getFileById(targets.guideFileId).getBlob().getBytes());
  const ratio = presentation.getPageWidth() / presentation.getPageHeight();
  if (Math.abs(ratio / (png.width / png.height) - 1) > 0.005) {
    throw new Error('안내도 PNG와 Google Slides 원본의 페이지 비율이 다릅니다.');
  }
  return {form: form.revisionId, guide: guide.headRevisionId, template: template.version};
}

function orgFormAccepting_(targets) {
  return FormApp.openById(targets.formId).isAcceptingResponses();
}

function orgSetFormAccepting_(targets, accepting) {
  const form = FormApp.openById(targets.formId);
  if (form.isAcceptingResponses() !== accepting) form.setAcceptingResponses(accepting);
  if (orgFormAccepting_(targets) !== accepting) {
    throw new Error('집중교육 폼 접수 상태를 확인하지 못했습니다.');
  }
}

function orgReadFormAsset_(targets) {
  return orgAssetJson_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(targets.formId));
}

function orgFormOptionValues_(item) {
  const choice = item?.questionItem?.question?.choiceQuestion;
  return item?.questionItem?.question?.required && ['RADIO', 'DROP_DOWN'].includes(choice?.type)
    ? choice.options : null;
}

function orgFormLayout_(form) {
  if (!form.formId || !form.linkedSheetId || !form.revisionId || !Array.isArray(form.items)) {
    throw new Error('집중교육 폼과 연결된 응답 시트를 확인하세요.');
  }
  const items = form.items;
  const firstPageEnd = items.findIndex(item => item.pageBreakItem);
  const groupItems = items.slice(0, firstPageEnd).filter(item => item.title === '군' && orgFormOptionValues_(item));
  const finalPages = items.filter(item => item.pageBreakItem && item.title === ORG_FORM_FINAL_PAGE);
  if (groupItems.length !== 1 || firstPageEnd < 0 || finalPages.length !== 1) {
    throw new Error('집중교육 폼의 군 문항과 참석자 정보 입력 페이지를 확인하세요.');
  }
  const finalPage = finalPages[0];
  const finalIndex = items.indexOf(finalPage);
  const sections = [];
  for (let index = firstPageEnd; index < finalIndex; index++) {
    const page = items[index];
    if (!page.pageBreakItem || !page.title?.endsWith(ORG_FORM_PAGE_SUFFIX)) continue;
    let end = index + 1;
    while (end < finalIndex && !items[end].pageBreakItem) end++;
    const teams = items.slice(index + 1, end).filter(item => item.title === '팀' && orgFormOptionValues_(item));
    if (teams.length === 1) sections.push({page, team: teams[0], index});
  }
  const group = groupItems[0];
  const choices = orgFormOptionValues_(group);
  const destinations = choices.map(option => option.goToSectionId);
  if (new Set(destinations).size !== choices.length || !choices.every(option => {
    const section = sections.find(candidate => candidate.page.itemId === option.goToSectionId);
    return section?.page.title === option.value + ORG_FORM_PAGE_SUFFIX &&
      orgFormOptionValues_(section.team).every(team => team.goToSectionId === finalPage.itemId);
  })) {
    throw new Error('집중교육 폼의 기존 군→팀→참석자 분기를 확인하세요.');
  }
  return {items, group, sections, finalPage, finalIndex};
}

function orgAssetOptions_(values, destination) {
  return values.map(value => ({value, goToSectionId: destination}));
}

function orgUpdateFormOptions_(item, index, options, requests) {
  const previous = orgFormOptionValues_(item);
  if (previous.length === options.length && previous.every((option, i) =>
    option.value === options[i].value && option.goToSectionId === options[i].goToSectionId && !option.isOther
  )) return;
  const next = JSON.parse(JSON.stringify(item));
  next.questionItem.question.choiceQuestion.options = options;
  requests.push({updateItem: {item: next, location: {index}, updateMask: ORG_FORM_OPTIONS_MASK}});
}

function orgPlanForm_(form, configuration, branchIds) {
  const layout = orgFormLayout_(form);
  const requests = [];
  const additions = [];
  const groupOptions = [];
  const reservedIds = new Set(branchIds.values());
  const selectedIds = new Set();
  for (const group of configuration.groups) {
    const pageTitle = group.label + ORG_FORM_PAGE_SUFFIX;
    const identity = group.id || group.key;
    const names = [group.key, group.label].concat(group.aliases || []);
    const generatedId = orgAssetDigest_(Utilities.DigestAlgorithm.SHA_256, 'org-team-section:' + identity).slice(0, 8);
    const priorIds = new Set(names.map(name => branchIds.get(name)).filter(Boolean));
    const mapped = branchIds.get(identity);
    if (!mapped && priorIds.size > 1) {
      throw new Error('집중교육 폼의 이전 군 이름이 서로 다른 페이지에 연결되어 있습니다. ' + group.label);
    }
    const knownId = mapped || [...priorIds][0] ||
      layout.sections.find(section => section.page.itemId === generatedId &&
        !reservedIds.has(generatedId) && section.page.title === pageTitle)?.page.itemId;
    const candidates = knownId ? layout.sections.filter(section => section.page.itemId === knownId) :
      layout.sections.filter(section => !reservedIds.has(section.page.itemId) &&
        names.includes(section.page.title.slice(0, -ORG_FORM_PAGE_SUFFIX.length)));
    if (candidates.length > 1 || (knownId && candidates.length !== 1)) {
      throw new Error('집중교육 폼의 군별 팀 페이지를 하나로 확인할 수 없습니다. ' + group.label);
    }
    const section = candidates[0];
    let pageId = knownId;
    const options = orgAssetOptions_(group.teams, layout.finalPage.itemId);
    if (section) {
      pageId = section.page.itemId;
      if (section.page.title !== pageTitle) {
        requests.push({updateItem: {item: {...section.page, title: pageTitle},
          location: {index: section.index}, updateMask: 'title'}});
      }
      orgUpdateFormOptions_(section.team, layout.items.indexOf(section.team), options, requests);
    } else {
      pageId = generatedId;
      if (reservedIds.has(pageId) || layout.items.some(item => item.itemId === pageId)) {
        throw new Error('집중교육 폼의 새 페이지 ID가 기존 문항과 겹칩니다.');
      }
      additions.push({itemId: pageId, title: pageTitle, pageBreakItem: {}}, {
        title: '팀',
        questionItem: {question: {required: true, choiceQuestion: {type: 'RADIO', options}}}
      });
    }
    if (selectedIds.has(pageId)) throw new Error('집중교육 폼의 두 군이 같은 페이지에 연결되어 있습니다.');
    selectedIds.add(pageId);
    groupOptions.push({value: group.label, goToSectionId: pageId});
    // 기존 페이지 연결을 보존해야 표시 이름을 바꿔도 예전 응답 열을 계속 쓸 수 있습니다.
    if (section) branchIds.set(identity, pageId);
  }
  additions.forEach((item, index) => requests.push({
    createItem: {item, location: {index: layout.finalIndex + index}}
  }));
  orgUpdateFormOptions_(layout.group, layout.items.indexOf(layout.group), groupOptions, requests);
  return requests;
}

function orgUpdateForm_(configuration, targets) {
  if (orgFormAccepting_(targets)) throw new Error('집중교육 폼 접수를 중지한 뒤 분기를 적용하세요.');
  const form = orgReadFormAsset_(targets);
  if (form.formId !== targets.formId) throw new Error('집중교육 폼 ID가 설정과 다릅니다.');
  const properties = PropertiesService.getScriptProperties();
  const property = 'ORG_FORM_BRANCH_IDS_' + targets.formId;
  const stored = properties.getProperty(property) || '[]';
  const branches = new Map(JSON.parse(stored));
  if (!branches.size) {
    const current = typeof readOrgConfiguration_ === 'function' ? readOrgConfiguration_() : null;
    const oldChoices = orgFormOptionValues_(orgFormLayout_(form).group);
    oldChoices.forEach(choice => {
      const group = current && findOrgGroup_(current, choice.value);
      const key = group?.id || group?.key || choice.value.replace(/군$/, '');
      if (branches.has(key)) throw new Error('집중교육 폼 기존 군 약칭이 겹칩니다.');
      branches.set(key, choice.goToSectionId);
    });
  }
  const requests = orgPlanForm_(form, configuration, branches);
  const mapped = JSON.stringify([...branches]);
  if (stored !== mapped) properties.setProperty(property, mapped);
  if (requests.length) {
    orgAssetJson_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(targets.formId) + ':batchUpdate', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({writeControl: {requiredRevisionId: form.revisionId}, requests})
    });
  }
  const result = orgReadFormAsset_(targets);
  const previous = new Map(form.items.map(item => [item.itemId, item.questionItem?.question?.questionId]));
  if (result.formId !== form.formId || result.responderUri !== form.responderUri ||
      result.linkedSheetId !== form.linkedSheetId ||
      !form.items.every(item => result.items.some(candidate => candidate.itemId === item.itemId &&
        candidate.questionItem?.question?.questionId === previous.get(item.itemId))) ||
      orgPlanForm_(result, configuration, branches).length) {
    throw new Error('집중교육 폼 분기, 문항 또는 응답 시트 연결을 확인하지 못했습니다.');
  }
  const verified = JSON.stringify([...branches]);
  if (mapped !== verified) properties.setProperty(property, verified);
}

function orgGuidePanel_(presentation) {
  const slides = presentation.getSlides();
  if (slides.length !== 1) throw new Error('안내도 템플릿은 슬라이드 한 장이어야 합니다.');
  const slide = slides[0];
  const markers = slide.getShapes().filter(shape =>
    shape.getTitle() === ORG_GUIDE_PANEL || shape.getDescription() === ORG_GUIDE_PANEL);
  if (markers.length !== 1) throw new Error('안내도 템플릿에서 ORG_TEAM_PANEL 도형 하나를 표시하세요.');
  const marker = markers[0];
  const left = marker.getLeft();
  const top = marker.getTop();
  const width = marker.getWidth();
  const height = marker.getHeight();
  if (marker.getRotation() !== 0 || left < 0 || top < 0 || width <= 0 || height <= 0 ||
      left + width > presentation.getPageWidth() || top + height > presentation.getPageHeight()) {
    throw new Error('안내도 군·팀 표 영역을 회전 없이 페이지 안에 배치하세요.');
  }
  return {slide, marker, left, top, width, height};
}

function orgGuideRows_(configuration, panel, pageWidth) {
  const unit = pageWidth / 1600;
  const inset = 8;
  const labelWidth = panel.width * 0.28;
  for (let pixels = 26; pixels >= 16; pixels--) {
    const font = pixels * unit;
    const labelChars = Math.floor((labelWidth - 2 * inset) / font);
    const teamChars = Math.floor((panel.width - labelWidth - 2 * inset) / font);
    if (labelChars < 1 || teamChars < 1) continue;
    const rows = [{label: '군', lines: ['팀']}];
    for (const group of configuration.groups) {
      if (Array.from(group.label).length > labelChars) break;
      const lines = [];
      let line = '';
      for (const team of group.teams) {
        if (Array.from(team).length > teamChars) {
          line = '';
          break;
        }
        const joined = line ? line + ' · ' + team : team;
        if (Array.from(joined).length > teamChars) {
          lines.push(line);
          line = team;
        } else {
          line = joined;
        }
      }
      if (!line) break;
      lines.push(line);
      rows.push({label: group.label, lines});
    }
    if (rows.length !== configuration.groups.length + 1) continue;
    rows.forEach(row => {row.height = row.lines.length * font * 1.3 + 8;});
    const minHeight = rows.reduce((total, row) => total + row.height, 0);
    if (minHeight <= panel.height) return {font, labelWidth, rows, extra: (panel.height - minHeight) / rows.length};
  }
  throw new Error('안내도 군·팀 표 영역이 작습니다. 팀 이름이나 템플릿의 표 영역을 확인하세요.');
}

function orgGuideText_(slide, text, left, top, width, height, font, color, centered, bold) {
  const box = slide.insertTextBox(text, left, top, width, height);
  box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  const range = box.getText();
  range.getTextStyle().setFontFamily('Noto Sans KR').setFontSize(font).setForegroundColor(color).setBold(bold);
  range.getParagraphStyle().setParagraphAlignment(centered
    ? SlidesApp.ParagraphAlignment.CENTER : SlidesApp.ParagraphAlignment.START)
    .setLineSpacing(110).setSpaceAbove(0).setSpaceBelow(0);
}

function orgRenderGuide_(configuration, targets) {
  if (!targets.guideTemplateId || targets.guideTemplateId === targets.guideFileId) {
    throw new Error('별도의 Google Slides 안내도 원본을 지정하세요.');
  }
  const source = DriveApp.getFileById(targets.guideTemplateId);
  const temporary = source.makeCopy('군·팀 안내도 렌더링', DriveApp.getRootFolder());
  try {
    const presentation = SlidesApp.openById(temporary.getId());
    const panel = orgGuidePanel_(presentation);
    const pageWidth = presentation.getPageWidth();
    const pageHeight = presentation.getPageHeight();
    const layout = orgGuideRows_(configuration, panel, pageWidth);
    const slideId = panel.slide.getObjectId();
    panel.marker.remove();
    let top = panel.top;
    layout.rows.forEach((row, i) => {
      const height = row.height + layout.extra;
      const fill = i === 0 ? '#173866' : i % 2 ? '#FFFFFF' : '#EDF4FC';
      const color = i === 0 ? '#FFFFFF' : '#173866';
      const border = panel.slide.insertShape(SlidesApp.ShapeType.RECTANGLE, panel.left, top, panel.width, height);
      border.getFill().setSolidFill(fill);
      border.getBorder().setTransparent();
      orgGuideText_(panel.slide, row.label, panel.left, top, layout.labelWidth, height, layout.font, color, true, true);
      orgGuideText_(panel.slide, row.lines.join('\n'), panel.left + layout.labelWidth, top,
        panel.width - layout.labelWidth, height, layout.font, color, false, i === 0);
      top += height;
    });
    presentation.saveAndClose();
    const thumbnail = orgAssetJson_('https://slides.googleapis.com/v1/presentations/' +
      encodeURIComponent(temporary.getId()) + '/pages/' + encodeURIComponent(slideId) +
      '/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE');
    if (!thumbnail.contentUrl || !/^https:\/\//.test(thumbnail.contentUrl)) {
      throw new Error('안내도 PNG 렌더링 주소를 확인하지 못했습니다.');
    }
    const blob = UrlFetchApp.fetch(thumbnail.contentUrl).getBlob();
    const size = orgPngDimensions_(blob.getBytes());
    if (Math.abs(size.width - size.height * pageWidth / pageHeight) > 2) {
      throw new Error('렌더링한 안내도 PNG와 원본의 페이지 비율이 다릅니다.');
    }
    return blob.setContentType('image/png').setName('층별안내도.png');
  } finally {
    temporary.setTrashed(true);
  }
}

function orgAssetDigest_(algorithm, bytes) {
  const digest = typeof bytes === 'string'
    ? Utilities.computeDigest(algorithm, bytes, Utilities.Charset.UTF_8)
    : Utilities.computeDigest(algorithm, bytes);
  return digest.map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function orgPngDimensions_(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (bytes.length < 24 || !signature.every((byte, i) => (bytes[i] & 255) === byte)) {
    throw new Error('안내도 이미지가 PNG 형식과 일치하지 않습니다.');
  }
  const read = start => bytes.slice(start, start + 4).reduce((value, byte) => value * 256 + (byte & 255), 0);
  const width = read(16);
  const height = read(20);
  if (!width || !height) throw new Error('안내도 PNG 크기를 확인하지 못했습니다.');
  return {width, height};
}

function orgAssetFile_(id) {
  return orgAssetJson_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '?supportsAllDrives=true&fields=id,mimeType,md5Checksum,headRevisionId,version,capabilities(canEdit,canCopy,canModifyContent)');
}

function orgCheckGuideFile_(targets) {
  const file = orgAssetFile_(targets.guideFileId);
  if (file.id !== targets.guideFileId || file.mimeType !== 'image/png' || !file.capabilities?.canModifyContent) {
    throw new Error('기존 안내도 PNG 파일과 수정 권한을 확인하세요.');
  }
  return file;
}

function orgUpdateGuide_(blob, targets) {
  const bytes = blob.getBytes();
  orgPngDimensions_(bytes);
  const hash = orgAssetDigest_(Utilities.DigestAlgorithm.MD5, bytes);
  const before = orgCheckGuideFile_(targets);
  if (before.md5Checksum === hash) return;
  orgAssetJson_('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(before.id) +
    '?uploadType=media&supportsAllDrives=true&fields=id,mimeType,md5Checksum,headRevisionId', {
    method: 'patch', contentType: 'image/png', payload: bytes
  });
  const after = orgCheckGuideFile_(targets);
  if (after.md5Checksum !== hash || !after.headRevisionId || after.headRevisionId === before.headRevisionId) {
    throw new Error('기존 안내도 PNG의 새 버전과 내용을 확인하지 못했습니다.');
  }
}

function orgAssetJson_(url, options) {
  const response = UrlFetchApp.fetch(url, {
    method: 'get', headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    muteHttpExceptions: true, ...options
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Google ' + (url.match(/https:\/\/([^/.]+)/)?.[1] || 'API') + ' 요청 실패 (' + status + ')');
  }
  return JSON.parse(response.getContentText());
}
