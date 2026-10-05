# Read-only explicit resources; no source directory glob or config.py inclusion.
import os
from pathlib import Path
root=Path(SPECPATH)
browsers=Path(os.environ['NEWACTS_BROWSER_PAYLOAD'])
a=Analysis([str(root/'desktop_app.py')],pathex=[str(root)],
    binaries=[],datas=[(str(root/'config.example.py'),'.')],
    hiddenimports=['keyring.backends.macOS','google.auth.transport.requests'],
    hookspath=[],hooksconfig={},runtime_hooks=[],excludes=['config','tkinter'],noarchive=False)
pyz=PYZ(a.pure)
exe=EXE(pyz,a.scripts,[],exclude_binaries=True,name='NewactsSettlement',debug=False,
        bootloader_ignore_signals=False,strip=False,upx=False,console=True,target_arch='arm64',codesign_identity=None,entitlements_file=None)
coll=COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='NewactsSettlement')
app=BUNDLE(coll,name='새가족 정착률.app',icon=None,bundle_identifier='kr.newacts.settlement',
           info_plist={'CFBundleDisplayName':'새가족 정착률','LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,'LSBackgroundOnly':False})
