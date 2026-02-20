
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

### Ubuntu/DEB:

<dl>
  <dd>
   <dd>
    <dd>
       <dd>
    <dd>
  
**Automatic (recommended)**
```shell
echo "deb [trusted=yes] https://chrisjbawden.github.io/cockpit-dockermanager stable main" \
  | sudo tee /etc/apt/sources.list.d/cockpit-dockermanager.list

sudo apt update
sudo apt install dockermanager
```
<details>
  <summary><strong>Manual</strong></summary>

```shell
curl -L -o dockermanager.deb https://github.com/chrisjbawden/cockpit-dockermanager/releases/download/latest/dockermanager.deb && sudo dpkg -i dockermanager.deb
```
</details>
  
  </dd>
    </dd>
      </dd>
  </dd>
  </dd>
<dl>
  
### Fedora/RHEL:

<dl>
  <dd>
   <dd>
    <dd>
       <dd>
    <dd>

**Automatic (recommended)**

```shell
sudo tee /etc/yum.repos.d/cockpit-dockermanager.repo <<'EOF'
[cockpit-dockermanager]
name=Cockpit Docker Manager
baseurl=https://chrisjbawden.github.io/cockpit-dockermanager/yum/stable/
enabled=1
gpgcheck=0
metadata_expire=0
EOF

sudo yum install -y dockermanager
```

<details>
  <summary><strong>Manual</strong></summary>


```shell
curl -sSL https://raw.githubusercontent.com/chrisjbawden/cockpit-dockermanager/main/install-fedora.sh | bash
```
</details>

  </dd>
    </dd>
      </dd>
  </dd>
  </dd>
<dl>

---

### Changelog

#### v1.0.8
- Toast notification modified
- Integrated cockpit superuser mechanism for permission management
- Theme support added

#### v1.0.7.3
- Bugfix - start/stop buttons in container dialog/pane
- Bugfix - toast notification styling
- Change to error handling - includes cli std output for torubleshooting
- 'Auto Prune' adjusted to remove all unused images (instead of only dangling)

#### v1.0.7.2
- Bugfix - stats
- Banner converted to toast notifications
- Bugfix - prunning button

#### v1.0.7

- Added modal to wrap logs, details and individual container terminal functionality
- Minor UI changes
- Added ability to delete containers


<div align="center">
  <a href="https://chrisjbawden.github.io/cockpit-dockermanager/index.html" target="_blank" rel="noopener noreferrer">...</a>
</div>
