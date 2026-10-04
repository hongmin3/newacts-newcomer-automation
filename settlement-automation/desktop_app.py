"""Finder/PyInstaller entry point. Importing this module starts no operation."""
import sys
from pathlib import Path
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication
from desktop.runtime import RuntimePaths
from desktop.settings import load_settings
from desktop.service import SettlementService
from desktop.window import MainWindow

def main() -> int:
    app=QApplication.instance() or QApplication(sys.argv)
    app.setFont(QFont('Apple SD Gothic Neo',11))
    paths=RuntimePaths.for_user(Path.home()); paths.ensure_directories()
    try: settings=load_settings(paths) if paths.settings_file.exists() else None
    except (ValueError,OSError): settings=None
    window=MainWindow(settings,paths,SettlementService); window.show()
    return app.exec()

if __name__=='__main__': sys.exit(main())
