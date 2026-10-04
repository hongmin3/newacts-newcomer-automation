"""Qt presentation layer. Remote work never runs on the GUI thread."""
import json
from html import escape
import threading
import runpy
from dataclasses import replace
from pathlib import Path
from PySide6.QtCore import QDate, QObject, QThread, QTimer, Qt, Signal, Slot, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QMainWindow,QWidget,QVBoxLayout,QHBoxLayout,QFormLayout,
    QLabel,QPushButton,QLineEdit,QDateEdit,QProgressBar,QTextBrowser,QListWidget,
    QListWidgetItem,QFileDialog,QCheckBox,QComboBox,QTableWidget,QTableWidgetItem)
from .runtime import RuntimePaths, SecretStore, write_private_file, resource_path
from .settings import AppSettings, load_settings, save_settings
from .service import RunRequest, RunOutcome, ProgressEvent, ReportPreview

def initial_settings(paths):
    try:
        return load_settings(paths)
    except (ValueError,OSError):
        defaults=runpy.run_path(str(resource_path('config.example.py')))
        return AppSettings(defaults['SHEET_URL'],defaults['SOURCE_SHEET_NAME'],defaults['RESULT_SHEET_NAME'],
            defaults['DIMODE_URL'],paths.oauth_client_file,paths.oauth_token_file)

class Worker(QObject):
    progress=Signal(object)
    result=Signal(object)
    failed=Signal()
    finished=Signal()
    def __init__(self, operation): super().__init__(); self.operation=operation
    @Slot()
    def execute(self):
        try: self.result.emit(self.operation(self.progress.emit))
        except Exception: self.failed.emit()
        finally: self.finished.emit()

class MainWindow(QMainWindow):
    def __init__(self, settings: AppSettings | None, paths: RuntimePaths, service_factory):
        super().__init__(); self.settings=settings; self.paths=paths; self.service=service_factory()
        self.thread=None; self.worker=None; self.cancel=threading.Event(); self.outcome=None
        self.previews=[]; self.viewed_reports=set(); self._closing=False; self._setup_candidate=None
        self.setWindowTitle('새가족 정착률'); self.resize(900,740)
        body=QWidget(); layout=QVBoxLayout(body); self.setCentralWidget(body)
        self.status_label=QLabel('최초 설정을 완료해 주세요.' if settings is None else '조회 준비'); layout.addWidget(self.status_label)
        self.progress_bar=QProgressBar(); layout.addWidget(self.progress_bar)
        self.setup_panel=QWidget(); form=QFormLayout(self.setup_panel)
        defaults=settings or initial_settings(paths)
        self.client_edit=QLineEdit(); picker=QPushButton('Google 인증 파일 선택')
        picker.clicked.connect(self.pick_client); row=QHBoxLayout(); row.addWidget(self.client_edit); row.addWidget(picker)
        form.addRow('Google OAuth 파일',row)
        self.account_edit=QLineEdit(defaults.dimode_account); form.addRow('디모데 계정',self.account_edit)
        self.password_edit=QLineEdit(); self.password_edit.setEchoMode(QLineEdit.Password); form.addRow('키체인에 저장할 암호',self.password_edit)
        self.roster_start=QDateEdit(QDate.fromString(defaults.roster_start or QDate(QDate.currentDate().year(),1,1).toString('yyyy-MM-dd'),'yyyy-MM-dd'))
        self.roster_end=QDateEdit(QDate.fromString(defaults.roster_end or QDate.currentDate().toString('yyyy-MM-dd'),'yyyy-MM-dd'))
        for editor in (self.roster_start,self.roster_end): editor.setCalendarPopup(True); editor.setDisplayFormat('yyyy-MM-dd')
        form.addRow('명단 시작일',self.roster_start); form.addRow('명단 종료일',self.roster_end)
        self.setup_button=QPushButton('암호 저장 · Google 승인 · 로그인 확인'); self.setup_button.clicked.connect(self.configure)
        form.addRow(self.setup_button); layout.addWidget(self.setup_panel); self.setup_panel.setVisible(settings is None)
        controls=QHBoxLayout(); self.historical=QCheckBox('과거 기준일 선택'); controls.addWidget(self.historical)
        self.as_of=QDateEdit(QDate.currentDate()); self.as_of.setCalendarPopup(True); self.as_of.setEnabled(False)
        self.historical.toggled.connect(self.as_of.setEnabled); controls.addWidget(self.as_of)
        self.run_button=QPushButton('새 조회 시작'); self.run_button.clicked.connect(self.start_run); controls.addWidget(self.run_button)
        self.cancel_button=QPushButton('취소'); self.cancel_button.clicked.connect(self.cancel.set); controls.addWidget(self.cancel_button)
        self.reset_button=QPushButton('인증 다시 설정'); self.reset_button.clicked.connect(lambda:self.setup_panel.show()); controls.addWidget(self.reset_button)
        layout.addLayout(controls)
        self.pending_combo=QComboBox(); self.resume_button=QPushButton('선택 실행 이어서'); self.resume_button.clicked.connect(self.resume_selected)
        recovery=QHBoxLayout(); recovery.addWidget(self.pending_combo); recovery.addWidget(self.resume_button); layout.addLayout(recovery)
        self.table=QTableWidget(); layout.addWidget(self.table)
        self.sheet_button=QPushButton('Google 시트 열기'); self.sheet_button.clicked.connect(self.open_sheet); layout.addWidget(self.sheet_button)
        self.preview_button=QPushButton('메일 미리보기'); self.preview_button.clicked.connect(self.preview_reports); layout.addWidget(self.preview_button)
        self.report_list=QListWidget(); self.report_list.setMaximumHeight(130); self.report_list.currentRowChanged.connect(self.display_preview); layout.addWidget(self.report_list)
        self.preview_browser=QTextBrowser(); layout.addWidget(self.preview_browser)
        self.resend=QCheckBox('표시된 마지막 발송일을 확인하고 재발송'); layout.addWidget(self.resend)
        self.send_button=QPushButton('선택한 보고서 발송'); self.send_button.clicked.connect(self.send_selected); layout.addWidget(self.send_button)
        self.refresh_pending(); self.set_busy(False)
        if settings is not None:
            # Interrupted work requires a human recovery/new-run choice.
            if self.pending_combo.count(): self.status_label.setText('중단된 실행이 있습니다. 이어서 실행하거나 새 조회를 선택해 주세요.')
            else: QTimer.singleShot(0,self.start_run)

    def pick_client(self):
        path,_=QFileDialog.getOpenFileName(self,'Google 인증 파일 선택','','JSON (*.json)')
        if path: self.client_edit.setText(path)

    def set_busy(self,busy):
        for button in (self.run_button,self.reset_button,self.setup_button,self.resume_button): button.setEnabled(not busy)
        self.run_button.setEnabled(not busy and self.settings is not None)
        self.resume_button.setEnabled(not busy and self.settings is not None and self.pending_combo.count()>0)
        self.cancel_button.setEnabled(busy)
        self.preview_button.setEnabled(not busy and self.outcome is not None)
        self.send_button.setEnabled(not busy and bool(self.previews))
        self.sheet_button.setEnabled(not busy and self.settings is not None)

    def launch(self,operation,handler):
        if self.thread is not None: return
        self.cancel=threading.Event(); self.set_busy(True)
        self.thread=QThread(self); self.worker=Worker(operation); self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.execute); self.worker.progress.connect(self.show_progress)
        self.worker.result.connect(handler); self.worker.failed.connect(self.show_failure)
        self.worker.finished.connect(self.thread.quit); self.worker.finished.connect(self.worker.deleteLater)
        self.thread.finished.connect(self.worker_stopped); self.thread.start()

    @Slot()
    def worker_stopped(self):
        old=self.thread; self.thread=None; self.worker=None; old.deleteLater(); self.set_busy(False)
        if self._closing: self.close()
        elif self._setup_candidate is not None:
            self.settings=self._setup_candidate; self._setup_candidate=None; self.setup_panel.hide(); self.start_run()

    @Slot()
    def show_failure(self):
        self._setup_candidate=None; self.status_label.setText('작업을 완료하지 못했습니다. 인증과 연결을 확인한 뒤 다시 시도해 주세요.')

    def configure(self):
        if self.thread is not None: return
        password=self.password_edit.text(); self.password_edit.clear()
        selected=self.client_edit.text(); account=self.account_edit.text().strip()
        base=self.settings or initial_settings(self.paths)
        candidate=replace(base,dimode_account=account,roster_start=self.roster_start.date().toString('yyyy-MM-dd'),
            roster_end=self.roster_end.date().toString('yyyy-MM-dd'),oauth_client_file=self.paths.oauth_client_file,oauth_token_file=self.paths.oauth_token_file)
        def setup(progress):
            candidate.validate()
            if not account or not password: raise ValueError()
            if selected:
                content=Path(selected).read_text(encoding='utf-8'); data=json.loads(content)
                if not isinstance(data,dict) or 'installed' not in data: raise ValueError()
                write_private_file(self.paths.oauth_client_file,content)
            if not self.paths.oauth_client_file.exists(): raise ValueError()
            secrets=self.service.secret_store or SecretStore(); secrets.set_password(account,password)
            self.service.secret_store=secrets
            progress(ProgressEvent('authentication',message_code='authentication_check'))
            if self.service.adapter is None:
                from .adapters import ProductionAdapter
                self.service.adapter=ProductionAdapter()
            try: self.service.adapter.authenticate(candidate,self.paths,secrets)
            finally: self.service.adapter.close()
            if self.cancel.is_set(): return None
            save_settings(self.paths,candidate); return candidate
        self.launch(setup,self.setup_completed)

    @Slot(object)
    def setup_completed(self,candidate): self._setup_candidate=candidate

    def start_run(self):
        if self.settings is None or self.thread is not None: return
        self.outcome=None; self.previews=[]; self.report_list.clear(); self.preview_browser.clear()
        request=RunRequest(as_of=self.as_of.date().toPython() if self.historical.isChecked() else None)
        self.launch(lambda progress:self.service.run(request,self.settings,self.paths,progress,self.cancel),self.show_outcome)

    def refresh_pending(self):
        self.pending_combo.clear()
        try:
            for run in self.service.pending_runs(self.paths):
                self.pending_combo.addItem(f"{run['as_of']} · {run['stage']} · {run['run_id']}",run['run_id'])
        except Exception: self.status_label.setText('이전 실행 기록을 읽지 못했습니다. 연결과 저장 권한을 확인해 주세요.')

    def resume_selected(self):
        run_id=self.pending_combo.currentData()
        if not run_id or self.settings is None: return
        self.previews=[]; self.report_list.clear()
        self.launch(lambda progress:self.service.resume(run_id,self.settings,self.paths,progress,self.cancel),self.show_outcome)

    @Slot(object)
    def show_progress(self,event: ProgressEvent):
        stages={'authentication':'인증 확인','roster':'명단 읽기','query':'출결 조회','publication':'시트 갱신','completed':'완료'}
        self.status_label.setText(f"{stages.get(event.stage,'작업 진행')} {event.completed}/{event.total}" if event.total else stages.get(event.stage,'작업 진행'))
        self.progress_bar.setRange(0,event.total or 0); self.progress_bar.setValue(event.completed)

    @Slot(object)
    def show_outcome(self,outcome: RunOutcome):
        self.outcome=outcome
        labels={'completed':'조회와 시트 갱신 완료','test':'시험 조회 완료','cancelled':'취소 완료. 이전 정상 현황은 보존됩니다.',
            'authentication_required':'인증을 다시 설정해 주세요.','quality_failed':'조회 완료율이 부족합니다. 확인 후 다시 조회해 주세요.',
            'publication_failed':'조회 결과는 보관했습니다. 중단 실행에서 시트 갱신을 이어서 실행해 주세요.',
            'busy':'다른 실행이 진행 중입니다. 완료 후 다시 시도해 주세요.','setup_required':'최초 설정을 확인해 주세요.'}
        self.status_label.setText(labels.get(outcome.status,'작업 상태를 확인해 주세요.'))
        if outcome.status in ('authentication_required','setup_required'): self.setup_panel.show()
        names={'army':'군','as_of':'기준일','member_count':'인원','completed_count':'조회 완료','review_count':'확인 대상','completion_rate':'조회 완료율','rate':'누적 출석률','recent_rate':'최근 4주 출석률','member_count_delta':'전월 인원 차이','rate_delta_pp':'누적 전월 차이 (퍼센트포인트)','recent_rate_delta_pp':'최근 4주 전월 차이 (퍼센트포인트)','insufficient_count':'관찰 기간 부족','no_target_count':'계산 대상 없음'}
        columns=[key for key in names if any(key in summary for summary in outcome.summaries)]
        self.table.setColumnCount(len(columns)); self.table.setHorizontalHeaderLabels([names[key] for key in columns]); self.table.setRowCount(len(outcome.summaries))
        for row,summary in enumerate(outcome.summaries):
            for col,key in enumerate(columns):
                value=summary.get(key)
                text='' if value is None else (f'{value*100:.1f}%' if key in ('completion_rate','rate','recent_rate') else str(value))
                self.table.setItem(row,col,QTableWidgetItem(text))
        self.table.resizeColumnsToContents()
        self.progress_bar.setRange(0,1); self.progress_bar.setValue(1 if outcome.status in ('completed','test') else 0)
        self.refresh_pending()

    def open_sheet(self):
        if self.settings: QDesktopServices.openUrl(QUrl(self.settings.sheet_url))

    def preview_reports(self):
        if self.thread is not None or self.outcome is None: return
        self.launch(lambda progress:self.service.preview_reports(self.outcome.run_id),self.show_previews)

    @Slot(object)
    def show_previews(self,previews):
        self.previews=previews; self.viewed_reports=set(); self.report_list.clear()
        for preview in previews:
            item=QListWidgetItem(f'{preview.title} · {preview.status} · 마지막 발송: {preview.last_sent_at or "없음"}'); item.setData(Qt.UserRole,preview.key)
            item.setFlags(item.flags()|Qt.ItemIsUserCheckable); item.setCheckState(Qt.Unchecked)
            if not preview.enabled or preview.status in ('uncertain','sending'): item.setFlags(item.flags() & ~Qt.ItemIsEnabled)
            self.report_list.addItem(item)
        if previews: self.report_list.setCurrentRow(0)

    def display_preview(self,row):
        if 0<=row<len(self.previews):
            p=self.previews[row]; self.viewed_reports.add(p.key)
            guidance=f'{p.title}\n수신 범위: {", ".join(p.recipients)}\n조회 품질: {"발송 가능" if p.enabled else p.reason}\n상태: {p.status}\n마지막 발송: {p.last_sent_at or "없음"}\n제목: {p.subject}'
            self.preview_browser.setHtml('<p>'+escape(guidance).replace('\n','<br>')+'</p><hr>'+(p.html or '<p>'+escape(p.text).replace('\n','<br>')+'</p>'))

    def send_selected(self):
        if self.thread is not None or not self.previews or self.outcome is None: return
        keys=[]
        for row,p in enumerate(self.previews):
            item=self.report_list.item(row)
            if item.checkState()==Qt.Checked and p.key in self.viewed_reports and p.enabled and p.status not in ('sending','uncertain') and (p.status!='sent' or self.resend.isChecked()): keys.append(p.key)
        if not keys: return
        resend=self.resend.isChecked(); self.resend.setChecked(False)
        self.launch(lambda progress:self.service.send_selected(self.outcome.run_id,keys,resend=resend),self.sent)

    @Slot(object)
    def sent(self,result):
        self.status_label.setText('발송 상태: '+', '.join(f'{key}: {value}' for key,value in result.items()))
        self.previews=[]; self.report_list.clear(); self.preview_browser.clear()

    def closeEvent(self,event):
        if self.thread is not None:
            self._closing=True; self.cancel.set(); self.status_label.setText('안전하게 작업을 마치는 중입니다.'); event.ignore()
        else: event.accept()
