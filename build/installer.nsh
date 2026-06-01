!macro customInit
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "POE2 Market Alert.exe"'
  Pop $0
  Sleep 2000
!macroend
