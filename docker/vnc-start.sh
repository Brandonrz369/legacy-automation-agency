#!/bin/bash
# Start VNC server for Computer Use sandbox

# Clean up stale lock files
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

# Start VNC server
vncserver :1 -geometry 1920x1080 -depth 24

# Start noVNC for web access
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5901 --listen 6080 &

echo "VNC server running on :5901"
echo "noVNC web access on :6080"

# Keep container alive
tail -f /dev/null
