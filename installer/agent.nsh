!macro customInstall
  nsExec::ExecToLog '"$INSTDIR\resources\agent\sfxchat-helper.exe" path-add "$INSTDIR\resources\agent"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$INSTDIR\resources\agent\sfxchat-helper.exe" path-remove "$INSTDIR\resources\agent"'
!macroend
