/**
 * ACTIVITY module - schema and controlled values (the single definition the
 * validator, repository and the frontend's meta call all read from).
 * Full documentation: docs/ACTIVITY_SCHEMA.md
 */

var ACTIVITY_SHEET = 'ACTIVITY';
var HISTORY_SHEET = 'ACTIVITY_HISTORY';
var REF_SHEET = 'ACTIVITY_REF';
var API_VERSION = '1.0.0';

// Ordered workflow. `board` decides which Kanban column group a status is in;
// `terminal` statuses are never "overdue".
var ACTIVITY_STATUSES = [
  { code: 'BACKLOG', label: 'Backlog', board: 'primary', terminal: false },
  { code: 'PLANNED', label: 'Planned', board: 'primary', terminal: false },
  { code: 'IN_PROGRESS', label: 'In Progress', board: 'primary', terminal: false },
  { code: 'FOR_REVIEW', label: 'For Review', board: 'primary', terminal: false },
  { code: 'COMPLETED', label: 'Completed', board: 'primary', terminal: true },
  { code: 'ON_HOLD', label: 'On Hold', board: 'secondary', terminal: false },
  { code: 'CANCELLED', label: 'Cancelled', board: 'secondary', terminal: true }
];
var ACTIVITY_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// type: text | date | timestamp | int | number
// mutable: false = system managed, never accepted from a client.
var ACTIVITY_COLUMNS = [
  { name: 'activity_id', type: 'text', mutable: false },
  { name: 'activity_date', type: 'date', required: true },
  { name: 'activity_type', type: 'text', required: true, ref: 'ACTIVITY_TYPE' },
  { name: 'activity_title', type: 'text', required: true, max: 200 },
  { name: 'activity_description', type: 'text', max: 4000 },
  { name: 'owner_id', type: 'text', required: true, ref: 'PERSON' },
  { name: 'assigned_to_id', type: 'text', ref: 'PERSON' },
  { name: 'status', type: 'text', required: true },
  { name: 'priority', type: 'text', required: true },
  { name: 'start_date', type: 'date' },
  { name: 'due_date', type: 'date' },
  { name: 'completed_date', type: 'date' },
  { name: 'progress_percent', type: 'int' },
  { name: 'location_id', type: 'text', max: 60 },
  { name: 'location_name', type: 'text', max: 200 },
  { name: 'brand_id', type: 'text', ref: 'BRAND' },
  { name: 'kpi_id', type: 'text', ref: 'KPI' },
  { name: 'target_value', type: 'number' },
  { name: 'actual_value', type: 'number' },
  { name: 'evidence_url', type: 'text', max: 2000 },
  { name: 'notes', type: 'text', max: 4000 },
  { name: 'status_changed_at', type: 'timestamp', mutable: false },
  { name: 'archived_at', type: 'timestamp', mutable: false },
  { name: 'archived_by', type: 'text', mutable: false },
  { name: 'created_at', type: 'timestamp', mutable: false },
  { name: 'created_by', type: 'text', mutable: false },
  { name: 'updated_at', type: 'timestamp', mutable: false },
  { name: 'updated_by', type: 'text', mutable: false }
];

var HISTORY_COLUMNS = ['history_id', 'activity_id', 'changed_at', 'changed_by', 'action', 'field', 'old_value', 'new_value'];
var REF_COLUMNS = ['ref_type', 'ref_id', 'label', 'sort_order', 'active'];
var REF_TYPES = ['PERSON', 'BRAND', 'ACTIVITY_TYPE', 'KPI'];

// Seed values for ACTIVITY_REF (first setup only; afterwards the sheet tab is
// the source). Derived from the Training Program & Delivery Monitoring 2026
// LISTS tab and the hub roster (CONFIG_VISITORS ids in data/kpi-monthly.json).
var REF_SEED = [
  ['PERSON', 'GIO', 'Geoffrey Carranceja'], ['PERSON', 'ALEX', 'Alex Rivera'],
  ['PERSON', 'RICE', 'Ricelle (Rice) Lim'], ['PERSON', 'JOSH', 'Josh Earnshaw'],
  ['PERSON', 'JAMES', 'James Nacionales'], ['PERSON', 'SKY', 'Sky'],
  ['PERSON', 'CHARLIE', 'Charlie Moises'], ['PERSON', 'LEO', 'Leo Fernandez'],
  ['PERSON', 'ANN', 'Ann Barredo'], ['PERSON', 'YANA', 'Alliana (Yana) Papa'],
  ['PERSON', 'VER', 'Ver Guerrero'], ['PERSON', 'DANIEL', 'Daniel De Leon'],
  ['BRAND', 'ANGELS_PIZZA', "Angel's Pizza"], ['BRAND', 'ANGELS_PIZZA_EXPRESS', "Angel's Pizza Express"],
  ['BRAND', 'FIGARO', 'Figaro'], ['BRAND', 'TIEN_MAS', "Tien Ma's"],
  ['BRAND', 'KOOBIDEH_KEBAB', 'Koobideh Kebab'], ['BRAND', 'MULTI_BRAND', 'Multi-brand'],
  // Training types exactly as listed in LISTS!A (business terminology).
  ['ACTIVITY_TYPE', 'ORIENTATION', 'Orientation'], ['ACTIVITY_TYPE', 'REFRESHER', 'Refresher'],
  ['ACTIVITY_TYPE', 'TLTC', 'TLTC (Team Leader Training & Certification)'],
  ['ACTIVITY_TYPE', 'SEMINAR_WORKSHOP', 'Seminar / Workshop'],
  ['ACTIVITY_TYPE', 'TECHNICAL_VALIDATION', 'Technical Validation'],
  ['ACTIVITY_TYPE', 'BARISTA_COFFEE_BAR', 'Barista / Coffee Bar'],
  ['ACTIVITY_TYPE', 'SERVICE_STEPS', 'Service Steps'], ['ACTIVITY_TYPE', 'RIDER_REFRESHER', 'Rider Refresher'],
  ['ACTIVITY_TYPE', 'COACHING_CORRECTIVE_ACTION', 'Coaching / Corrective Action'],
  ['ACTIVITY_TYPE', 'TRAIN_THE_TRAINER', 'Train-the-Trainer'],
  // Non-training activities the five KRAs also cover (NOT in the source sheet;
  // additions pending business confirmation - see docs/ACTIVITY_SCHEMA.md).
  ['ACTIVITY_TYPE', 'STORE_VISIT', 'Store Visit'], ['ACTIVITY_TYPE', 'MEETING', 'Meeting'],
  ['ACTIVITY_TYPE', 'FOLLOW_UP', 'Follow-up'], ['ACTIVITY_TYPE', 'REPORTING', 'Reporting'],
  ['ACTIVITY_TYPE', 'OTHER', 'Other'],
  // The five KRAs from the hub README.
  ['KPI', 'ATTENDANCE', 'Attendance / Punctuality / Behavior'], ['KPI', 'STORE_VISITS', 'Store Visit Compliance'],
  ['KPI', 'CROSS_TRAINING', 'Staff Proficiency / Cross-Training'], ['KPI', 'TRAINING_DELIVERY', 'Training Program Delivery'],
  ['KPI', 'COACHING', 'Coaching & Feedback']
];
