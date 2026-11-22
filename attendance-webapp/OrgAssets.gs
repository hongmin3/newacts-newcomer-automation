const ORG_GUIDE_PANEL = 'ORG_TEAM_PANEL';
const ORG_FORM_PAGE_SUFFIX = ' - 팀 선택';
const ORG_FORM_FINAL_PAGE = '참석자 정보 입력';

function orgCheckAssets_(targets) {
  const formFile = orgAssetFile_(targets.formId);
  if (formFile.mimeType !== 'application/vnd.google-apps.form' || !formFile.capabilities?.canEdit) {
    throw new Error('집중교육 폼을 편집할 권한을 확인하세요.');
  }
  const form = FormApp.openById(targets.formId);
  const layout = orgFormLayout_(form);
  orgVerifyFormRoutes_(layout);

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
  return {form: orgFormFingerprint_(form, layout), guide: guide.headRevisionId, template: template.version};
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

function orgFormChoiceItem_(item) {
  if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) return item.asMultipleChoiceItem();
  if (item.getType() === FormApp.ItemType.LIST) return item.asListItem();
  return null;
}

function orgFormLayout_(form) {
  if (!form.getDestinationId() || form.getDestinationType() !== FormApp.DestinationType.SPREADSHEET) {
    throw new Error('집중교육 폼과 연결된 응답 시트를 확인하세요.');
  }
  const items = form.getItems();
  const pageBreak = item => item.getType() === FormApp.ItemType.PAGE_BREAK;
  const firstPageEnd = items.findIndex(pageBreak);
  const groupItems = items.slice(0, firstPageEnd).filter(item => item.getTitle() === '군')
    .map(orgFormChoiceItem_).filter(item => item?.isRequired());
  const finalPages = items.filter(item => pageBreak(item) && item.getTitle() === ORG_FORM_FINAL_PAGE);
  if (groupItems.length !== 1 || firstPageEnd < 0 || finalPages.length !== 1) {
    throw new Error('집중교육 폼의 군 문항과 참석자 정보 입력 페이지를 확인하세요.');
  }
  const finalPage = finalPages[0].asPageBreakItem();
  const finalIndex = finalPage.getIndex();
  const sections = [];
  for (let index = firstPageEnd; index < finalIndex; index++) {
    const item = items[index];
    if (!pageBreak(item) || !String(item.getTitle() || '').endsWith(ORG_FORM_PAGE_SUFFIX)) continue;
    let end = index + 1;
    while (end < finalIndex && !pageBreak(items[end])) end++;
    const teams = items.slice(index + 1, end).filter(item => item.getTitle() === '팀')
      .map(orgFormChoiceItem_).filter(team => team?.isRequired());
    if (teams.length === 1) sections.push({page: item.asPageBreakItem(), team: teams[0]});
  }
  return {items, group: groupItems[0], sections, finalPage};
}

function orgFormChoiceRoutes_(item) {
  return item.getChoices().map(choice => [choice.getValue(), choice.getGotoPage()?.getId() ?? null]);
}

function orgVerifyFormRoutes_(layout) {
  const routes = orgFormChoiceRoutes_(layout.group);
  const destinations = routes.map(route => route[1]);
  if (!routes.length || new Set(destinations).size !== routes.length || !routes.every(([value, id]) => {
    const branch = layout.sections.find(section => section.page.getId() === id);
    if (branch?.page.getTitle() !== value + ORG_FORM_PAGE_SUFFIX) return false;
    const teamRoutes = orgFormChoiceRoutes_(branch.team);
    return teamRoutes.length && teamRoutes.every(route => route[1] === layout.finalPage.getId());
  })) {
    throw new Error('집중교육 폼의 기존 군→팀→참석자 분기를 확인하세요.');
  }
}

function orgFormFingerprint_(form, layout) {
  const items = layout.items.map(item => {
    const choice = orgFormChoiceItem_(item);
    return [item.getId(), String(item.getType()), item.getTitle(), item.getHelpText(),
      choice ? [choice.isRequired(), orgFormChoiceRoutes_(choice)] : null];
  });
  return orgAssetDigest_(Utilities.DigestAlgorithm.SHA_256, JSON.stringify([
    form.getId(), form.getDestinationId(), form.getPublishedUrl(), form.getTitle(),
    form.getDescription(), form.isAcceptingResponses(), items
  ]));
}

function orgSetFormChoices_(item, options) {
  const routes = options.map(([label, page]) => [label, page.getId()]);
  if (JSON.stringify(orgFormChoiceRoutes_(item)) !== JSON.stringify(routes)) {
    item.setChoices(options.map(([label, page]) => item.createChoice(label, page)));
  }
}

function orgFindFormBranch_(layout, group, branches) {
  const identity = group.id || group.key;
  const names = [group.key, group.label].concat(group.aliases || []);
  const mapped = branches.get(identity);
  const priorIds = new Set(names.map(name => branches.get(name)).filter(id => id !== undefined));
  if (mapped === undefined && priorIds.size > 1) {
    throw new Error('집중교육 폼의 이전 군 이름이 서로 다른 페이지에 연결되어 있습니다. ' + group.label);
  }
  const knownId = mapped ?? [...priorIds][0];
  const reserved = new Set(branches.values());
  const found = layout.sections.filter(section => knownId !== undefined ? section.page.getId() === knownId :
    !reserved.has(section.page.getId()) &&
    names.includes(section.page.getTitle().slice(0, -ORG_FORM_PAGE_SUFFIX.length)));
  if (found.length > 1 || (knownId !== undefined && found.length !== 1)) {
    throw new Error('집중교육 폼의 군별 팀 페이지를 하나로 확인할 수 없습니다. ' + group.label);
  }
  return found[0];
}

function orgFormAppendItem_(form, intent, field, type, add, save) {
  const items = form.getItems();
  if (intent[field] !== undefined) {
    const item = items.find(current => current.getId() === intent[field]);
    if (!item || item.getType() !== type) throw new Error('추가 중인 집중교육 폼 문항을 찾지 못했습니다.');
    return item;
  }
  if (intent.anchor === undefined) {
    intent.anchor = items[items.length - 1].getId();
    save();
  }
  const anchor = items.findIndex(item => item.getId() === intent.anchor);
  const appended = items.slice(anchor + 1);
  if (anchor < 0 || appended.length > 1 ||
      appended.some(item => item.getType() !== type || item.getTitle() || item.getHelpText())) {
    throw new Error('추가 중인 집중교육 폼 문항 뒤에 다른 변경이 있어 확인이 필요합니다.');
  }
  // 추가 호출만 반영되고 응답이 끊겼다면, 기록해 둔 마지막 항목 뒤의 한 문항을 이어서 씁니다.
  const item = appended[0] || add();
  intent[field] = item.getId();
  delete intent.anchor;
  save();
  const recorded = form.getItemById(intent[field]);
  if (!recorded) throw new Error('추가한 집중교육 폼 문항을 다시 읽지 못했습니다.');
  return recorded;
}

function orgMoveFormItemBefore_(form, itemId, finalId) {
  const items = form.getItems();
  const from = items.findIndex(item => item.getId() === itemId);
  const final = items.findIndex(item => item.getId() === finalId);
  if (from < 0 || final < 0) throw new Error('집중교육 폼의 새 분기 또는 마지막 페이지를 찾지 못했습니다.');
  if (from !== final - 1) form.moveItem(from, from < final ? final - 1 : final);
}

function orgCreateFormBranch_(form, group, finalPage, intent, save) {
  const page = orgFormAppendItem_(form, intent, 'pageId', FormApp.ItemType.PAGE_BREAK,
    () => form.addPageBreakItem(), save).asPageBreakItem();
  const team = orgFormAppendItem_(form, intent, 'teamId', FormApp.ItemType.MULTIPLE_CHOICE,
    () => form.addMultipleChoiceItem(), save).asMultipleChoiceItem();
  orgMoveFormItemBefore_(form, team.getId(), finalPage.getId());
  orgMoveFormItemBefore_(form, page.getId(), team.getId());
  orgUpdateFormBranch_({page, team}, group, finalPage);
  return {page, team};
}

function orgUpdateFormBranch_(branch, group, finalPage) {
  const title = group.label + ORG_FORM_PAGE_SUFFIX;
  if (branch.page.getTitle() !== title) branch.page.setTitle(title);
  if (branch.team.getTitle() !== '팀') branch.team.setTitle('팀');
  if (!branch.team.isRequired()) branch.team.setRequired(true);
  orgSetFormChoices_(branch.team, group.teams.map(team => [team, finalPage]));
}

function orgUpdateForm_(configuration, targets) {
  const form = FormApp.openById(targets.formId);
  if (form.isAcceptingResponses()) throw new Error('집중교육 폼 접수를 중지한 뒤 분기를 적용하세요.');
  if (form.getId() !== targets.formId) throw new Error('집중교육 폼 ID가 설정과 다릅니다.');
  const initial = orgFormLayout_(form);
  const publishedUrl = form.getPublishedUrl();
  const destination = form.getDestinationId();
  const properties = PropertiesService.getScriptProperties();
  const property = 'ORG_FORM_BRANCH_IDS_' + targets.formId;
  const pendingProperty = 'ORG_FORM_BRANCH_PENDING_' + targets.formId;
  const branches = new Map(JSON.parse(properties.getProperty(property) || '[]'));
  const saveBranches = () => properties.setProperty(property, JSON.stringify([...branches]));
  let pending = JSON.parse(properties.getProperty(pendingProperty) || 'null');
  const savePending = () => properties.setProperty(pendingProperty, JSON.stringify(pending));
  if (!branches.size) {
    orgVerifyFormRoutes_(initial);
    const current = typeof readOrgConfiguration_ === 'function' ? readOrgConfiguration_() : null;
    orgFormChoiceRoutes_(initial.group).forEach(([value, id]) => {
      const group = current && findOrgGroup_(current, value);
      const key = group?.id || group?.key || value.replace(/군$/, '');
      if (branches.has(key)) throw new Error('집중교육 폼 기존 군 약칭이 겹칩니다.');
      branches.set(key, id);
    });
    saveBranches();
  }

  function completeBranch(group) {
    const identity = group.id || group.key;
    const branch = orgCreateFormBranch_(form, group, initial.finalPage, pending, savePending);
    branches.set(identity, branch.page.getId());
    saveBranches();
    properties.deleteProperty(pendingProperty);
    pending = null;
    return branch;
  }
  let layout = initial;
  if (pending) {
    const group = configuration.groups.find(item => (item.id || item.key) === pending.identity);
    if (!group) throw new Error('집중교육 폼에서 추가를 이어 갈 군을 설정에서 찾지 못했습니다.');
    completeBranch(group);
    layout = orgFormLayout_(form);
  }
  const selected = new Set();
  const choices = configuration.groups.map(group => {
    const identity = group.id || group.key;
    let branch = orgFindFormBranch_(layout, group, branches);
    if (branch) {
      if (selected.has(branch.page.getId())) throw new Error('집중교육 폼의 두 군이 같은 페이지에 연결되어 있습니다.');
      if (branches.get(identity) !== branch.page.getId()) {
        branches.set(identity, branch.page.getId());
        saveBranches();
      }
      orgUpdateFormBranch_(branch, group, initial.finalPage);
    } else {
      pending = {identity};
      branch = completeBranch(group);
      layout.sections.push(branch);
    }
    selected.add(branch.page.getId());
    return [group.label, branch.page];
  });
  orgSetFormChoices_(initial.group, choices);

  const result = FormApp.openById(targets.formId);
  const verified = orgFormLayout_(result);
  orgVerifyFormRoutes_(verified);
  const itemIds = new Set(verified.items.map(item => item.getId()));
  const actualChoices = orgFormChoiceRoutes_(verified.group);
  const expectedChoices = choices.map(([label, page]) => [label, page.getId()]);
  if (result.getId() !== targets.formId || result.getPublishedUrl() !== publishedUrl ||
      result.getDestinationId() !== destination || result.isAcceptingResponses() ||
      !initial.items.every(item => itemIds.has(item.getId())) ||
      JSON.stringify(actualChoices) !== JSON.stringify(expectedChoices) ||
      !configuration.groups.every((group, index) => {
        const branch = verified.sections.find(section => section.page.getId() === actualChoices[index][1]);
        return JSON.stringify(orgFormChoiceRoutes_(branch.team).map(route => route[0])) === JSON.stringify(group.teams);
      })) {
    throw new Error('집중교육 폼 분기, 문항 또는 응답 시트 연결을 확인하지 못했습니다.');
  }
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
    const thumbnail = Slides.Presentations.Pages.getThumbnail(temporary.getId(), slideId, {
      'thumbnailProperties.mimeType': 'PNG', 'thumbnailProperties.thumbnailSize': 'LARGE'
    });
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
  return Drive.Files.get(id, {
    supportsAllDrives: true,
    fields: 'id,mimeType,md5Checksum,headRevisionId,version,capabilities(canEdit,canCopy,canModifyContent)'
  });
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
  Drive.Files.update({}, before.id, blob.setContentType('image/png'), {supportsAllDrives: true});
  const after = orgCheckGuideFile_(targets);
  if (after.md5Checksum !== hash || !after.headRevisionId || after.headRevisionId === before.headRevisionId) {
    throw new Error('기존 안내도 PNG의 새 버전과 내용을 확인하지 못했습니다.');
  }
}
