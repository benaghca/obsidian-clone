# Distributing Cinder at work (parked)

Status: on hold until IT has answered the questions below. Nothing here is built yet.

## Goal

Co-workers install Cinder from Software Center, deployed by IT through Intune or Configuration Manager.

## Until then

Share `cinder.exe` itself. It's one self-contained file that needs no installer and no admin rights. It keeps settings in `%LOCALAPPDATA%\Cinder` and never writes next to itself. Because it's unsigned, Windows SmartScreen warns about it when it's downloaded ("Windows protected your PC" → **More info** → **Run anyway**), and a strict security policy may block it outright.

## Planned installer

- An MSI, because Intune and Configuration Manager both deploy MSIs as they are.
- Installs for all users (per machine) into `Program Files\Cinder`, with a Start menu shortcut and an entry in **Installed apps** for uninstalling.
- Installs silently with `msiexec /i Cinder.msi /qn`. IT can detect it by its MSI product code.
- Installing a newer version replaces the older one. The MSI's upgrade code must never change after the first release.
- Notes, settings and history are per user and stay outside Program Files, so uninstalling never touches them.
- The WebView2 Runtime is a prerequisite. It ships with Windows 11 and current Windows 10.

## Questions for IT

1. Do you take internal or third-party apps for Software Center, and what's the request process?
2. Intune or Configuration Manager? Do you want an MSI, or would you rather package the `.exe` yourselves?
3. Code signing: do you sign internal apps with the company certificate, or must the vendor sign? Is there an application-control policy (WDAC or AppLocker) that unsigned apps must get through?
4. Are there rules for the product name, publisher, install folder or version numbers?
5. What do you need for your security review? The README's "For IT" section covers network use, data locations and dependencies.
