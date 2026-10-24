export const notes = Object.fromEntries([
  ['Task A', 'open', 3, '2000-01-01'], ['Task B', 'done', 4, '2099-01-01'],
  ['Task C', 'open', 2, '2099-01-01'], ['Task D', 'open', 5, '2099-01-01'],
  ['Task E', 'open', null, null], ['Task F', 'open', 3, null],
].map(([name,status,priority,due]) => [`BaseTest/${name}.md`, `---\nstatus: ${status}\n${priority === null ? '' : `priority: ${priority}\n`}${due ? `due: ${due}\n` : ''}tags:\n  - work/project\nactive: true\n---\n# ${name}\n## Details\n### More\n[[Task A]] #inline\n`]));
export const bases = {
  'Tasks.base': `filters:
  and:
    - file.inFolder("BaseTest")
    - 'status != "done"'
formulas:
  late: 'if(due < today(), "late", "")'
properties:
  note.status:
    displayName: Status
  formula.late:
    displayName: Late
views:
  - type: table
    name: Open tasks
    order:
      - file.name
      - status
      - priority
      - due
      - tags
      - formula.late
    sort:
      - property: priority
        direction: DESC
`,
 'Empty.base': '',
 'Multiple.base': `filters: 'file.inFolder("BaseTest")'
views:
  - type: table
    name: Multiple
    filters:
      or:
        - 'status == "open"'
        - 'priority == 4'
    order:
      - file.name
      - priority
      - active
    sort:
      - property: priority
        direction: ASC
      - property: file.name
        direction: DESC
    limit: 4
`,
 'Not.base': `filters:
  and:
    - file.inFolder("BaseTest")
    - not:
        - 'status == "done"'
        - 'priority == 5'
views:
  - type: table
    name: Not
`,
 'Unsupported.base': `filters: 'file.inFolder("BaseTest")'
formulas:
  missing: 'unknownFunction(priority)'
views:
  - type: table
    name: Unsupported
    order:
      - file.name
      - formula.missing
`,
 'Functions.base': `filters:
  and:
    - file.inFolder("BaseTest")
    - 'file.hasTag("work") && file.hasTag("inline")'
    - file.hasLink("Task A")
    - 'tags.contains("work/project") && status.contains("op")'
    - 'file.ext == "md" && file.folder == "BaseTest" && file.path != "missing" && file.name != "missing"'
views:
  - type: table
    name: Functions
    order:
      - file.name
      - active
      - file.tags
`,
 'Unsupported filter.base': `filters:
  and:
    - file.inFolder("BaseTest")
    - unknownFunction(status)
views:
  - type: table
    name: Unsupported filter
`,
 'Invalid.base': 'views:\n  - type: [broken\n',
};
