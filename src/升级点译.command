#!/bin/zsh
SCRIPT_DIR="${0:A:h}"
/usr/bin/env python3 "$SCRIPT_DIR/upgrade/install.py"
result=$?
printf '\n按回车关闭窗口。'
read -r
exit "$result"
