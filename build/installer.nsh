!macro customInit
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 3000
!macroend

!macro customCheckAppRunning
  DetailPrint 'Closing running "${PRODUCT_NAME}" before install...'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 5000
!macroend
