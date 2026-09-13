# Show all managed browser identities, instances and CDP sessions.
default: status

status:
    python3 scripts/managed.py status

menu:
    python3 scripts/managed.py menu

managed-install:
    python3 scripts/managed.py install

managed-stop:
    python3 scripts/managed.py stop

managed-start:
    python3 scripts/managed.py start

disconnect instance:
    python3 scripts/managed.py disconnect {{quote(instance)}}

profile:
    python3 scripts/switch-profile.py status

# Legacy switching is disabled when managed browsers are installed.
switch profile:
    python3 scripts/switch-profile.py {{quote(profile)}}

cesar:
    @just switch cesar

tyson:
    @just switch tyson
