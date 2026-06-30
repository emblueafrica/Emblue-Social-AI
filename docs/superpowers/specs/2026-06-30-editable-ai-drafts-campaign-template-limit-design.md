# Editable AI Drafts And Campaign Template Limit

## Scope

- Make the selected AI Reply Engine draft editable before copy or approval.
- Preserve edits while the queue item remains selected and use the edited value for sending.
- Replace an edited value when the user explicitly regenerates the draft.
- Limit New/Edit Campaign reply templates to 150 characters in the UI and API.

## Behavior

The AI Reply Engine resolves draft text in this order: operator edit, latest generated draft, backend queue draft. Regeneration becomes the new editable value. Successful approval or dismissal removes local edited state for that queue item.

Campaign template inputs show a 150-character counter and prevent additional input beyond the limit. API create/update routes reject templates longer than 150 characters instead of silently truncating them.

## Verification

- Unit-test draft precedence and the 150-character API boundary.
- Run backend and frontend production builds.
