# Docker sandbox for Computer Use execution
# This provides a sandboxed desktop environment where Claude Code
# can operate legacy software via screenshots, mouse, and keyboard.
#
# Based on V3 Blueprint: SUPERVISE mode execution container

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install desktop environment and VNC
RUN apt-get update && apt-get install -y \
    xfce4 \
    xfce4-goodies \
    tigervnc-standalone-server \
    tigervnc-common \
    novnc \
    websockify \
    dbus-x11 \
    x11-utils \
    xdotool \
    imagemagick \
    scrot \
    python3 \
    python3-pip \
    curl \
    wget \
    unzip \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js for the agent runtime
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Create agent user
RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

# Set up VNC
RUN mkdir -p /home/agent/.vnc \
    && echo "password" | vncpasswd -f > /home/agent/.vnc/passwd \
    && chmod 600 /home/agent/.vnc/passwd

# VNC startup script
COPY --chown=agent:agent docker/vnc-start.sh /home/agent/vnc-start.sh
RUN chmod +x /home/agent/vnc-start.sh

# Expose VNC (5901) and noVNC web (6080) ports
EXPOSE 5901 6080

# Default: start VNC server
CMD ["/home/agent/vnc-start.sh"]
