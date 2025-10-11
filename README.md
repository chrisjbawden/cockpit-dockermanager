
<h1 align="center">🐳 Cockpit Docker Manager</h1>
  
**Docker Manager** is a lightweight and intuitive utility designed to help you manage your Docker containers via a simplified interface. Whether you're a system administrator, developer, or DevOps engineer, DockerManager makes container visibility and management easier and more accessible.

---

<div align="center">
  <img src="misc/interface.png" alt="DockerManager Interface" style="width:70%; margin:auto;"/>
</div>

---

## 🚀 Features

- ✅ List, start, stop, search and restart containers
- 🔍 View container status, uptime, details and exposed ports
- 💻 In window terminal (now with individual container terminal functionality)
- 💾 Image management

## 🛠️ Installation

### Ubuntu:

```shell
curl -L -o dockermanager.deb https://github.com/chrisjbawden/cockpit-dockermanager/releases/download/latest/dockermanager.deb && sudo dpkg -i dockermanager.deb
```
### Fedora/RHEL:

```shell
curl -sSL https://raw.githubusercontent.com/chrisjbawden/cockpit-dockermanager/main/install-fedora.sh | bash
```

---

### Changelog

#### v1.0.7

- Added model to wrap logs, details and individual container terminal functionality
- Added individual terminal functionality
- Added container details
- Minor UI changes
- Added ability to delete containers

#### v1.0.6

- Added functionality to pin/fix header
- Added functionality to delete images
- Resource stats update pushed to background

#### v1.0.5

- Added "sort-by" functionality
- Added search functionality
- Fixed terminal button
- Modified refresh interval to 3mins

#### v1.0.4

- Added Real time log, CPU/memory monitoring

#### v1.0.3

- In window terminal functionality implemented
