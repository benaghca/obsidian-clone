import {notes as oldNotes,bases as oldBases} from '../round30-shots/fixtures.mjs';
export const notes={...oldNotes,'BaseTest/Task F.md':oldNotes['BaseTest/Task F.md'].replace('tags:', 'due: 2000-01-01\ntags:')};
export const bases={'Tasks.base':oldBases['Tasks.base'],'By due.base':`# Keep this comment
filters:
  not:
    - status == "waiting"
properties:
  file.name:
    displayName: Task
  note.due:
    displayName: Due date
views:
  - type: table
    name: "By due"
    filters:
      or:
        - file.hasTag("work")
        - priority > 1
    order:
      - file.name
      - due
      - priority
      - status
    sort:
      - property: due
        direction: ASC
      - property: file.name
        direction: DESC
    limit: 3
# Keep this too
`};
