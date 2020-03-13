# Header switcher for vscode

Simple extension to switch between header and source file in vscode.
Press Ctrl+Shift+O to find the nearest header.

Predefined path pairs (for instance linking internal/src with public/include) can be configured in the workspace settings.
These paths work recursively, so if a pair is made out of ./include and ./src, the files
./include/subfolder/file.h and ./src/subfolder/file.c will be paired.
