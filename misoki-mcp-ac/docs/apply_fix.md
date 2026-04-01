Safe Fix Apply — Review-First Flow
Problem Analysis
The current "Apply Safe Fixes" flow has correctness and UX issues:
One click applies all fixable issues with no selection or confirmation
The label implies repository mutation, but patches are only generated in-memory and surfaced in the UI
app/core/issue_mapper.py marks unreachable_code as fixable, but app/services/apply_fix_service.py only implements unused_import and unused_variable, so some "safe" fixes are skipped at apply time
Users cannot review all diffs before applying the batch
There is no per-file or per-fix control, which is risky even for low-risk patches
Current State
The web UI calls applySafeFixes() directly from web/src/app/results/page.tsx, sending every fixable issue at once. Individual preview exists via previewFix(), but there is no batch review step. The backend already has robust per-fix preview/apply logic in app/services/fix_preview_service.py and app/services/apply_fix_service.py, but the frontend bypasses review and selection.
Proposed Changes
Backend
Add a batch preview endpoint in app/api/routes_preview.py backed by app/services/fix_preview_service.py that accepts multiple fix IDs and returns preview payloads for each fix in one request. This avoids N sequential preview calls from the browser.
Align fixability with real support by removing unreachable_code from SAFE_FIX_TYPES in app/core/issue_mapper.py unless a concrete safe apply implementation is added.
Frontend
Replace the one-click apply action in web/src/app/results/page.tsx with a review-first flow:
Rename the CTA from "Apply Safe Fixes" to "Review Patches"
Open a new ReviewFixesModal component that loads batch previews, groups fixes by file, shows risk/source type, and allows per-fix selection
Default all supported fixes to selected, but require explicit confirmation before generating the combined patch set
Keep the existing post-apply results modal, but make the copy explicit that patches are generated/reviewed and can then be handed to the agent for PR drafting
Add client support in web/src/lib/api.ts and web/src/lib/types.ts for batch preview responses.
UX Requirements
The review modal should make the system safer and clearer:
Show exactly which fixes are selected
Surface skipped/unsupported fixes before confirmation, not after
Let the user deselect entire files or individual fixes
Show inline diffs before confirmation
Use language like "Generate Patches" or "Prepare Safe Patches" instead of "Apply" until the user confirms the selection
Validation
Verify that:
Only actually supported safe fixes are marked fixable
Batch preview returns the same diffs as individual preview
The results page can review, select, confirm, and then generate the same final combined_diff
Existing PR-drafting flow still works with the resulting patch bundle
The Docker/local browser proxy flow remains unchanged because requests still go through /api/analysis/*
