import 'walk_data_core.dart';
import 'walk_fixtures.dart';

// HR. Matrix, leave events, tasks, announcements, polls and articles are copied from hr_attendance_test,
// hr_leaves_test, hr_tasks_performance_test, hr_more_test and hr_manage_test; list keys follow the real routes.

Map<String, dynamic> _employee(String id, String name, String code) => {
      'id': id,
      'name': name,
      'full_name': name,
      'user_name': name,
      'display_name': name,
      'user_phone': '9876543210',
      'phone': '9876543210',
      'user_email': 'asha@example.com',
      'email': 'asha@example.com',
      'employee_code': code,
      'designation': 'Sales',
      'department': 'Sales',
      'employment_type': 'full_time',
      'joining_date': '2025-04-01',
      'is_active': true,
      'user_is_active': true,
      'salary': '25000.00',
      'gross_salary': '25000.00',
      'pay_basis': 'monthly',
      'pan_number': 'ABCDE1234F',
      'branch_id': 'br1',
      'reporting_manager_id': null,
      'role_id': 'r1',
      'role_name': 'Accountant',
      'role_key': 'accountant',
      'status': 'active',
      'attendance_status': 'present',
    };

Map<String, dynamic> _cell(String kind, String label, {num hours = 0, String code = ''}) => {
      'kind': kind,
      'label': label,
      'hours': hours,
      'countsAsDay': kind == 'present',
      'calendarCode': code,
      'missingOutPunch': false,
      'earlyMinutes': 0,
      'lateMinutes': 0,
    };

Map<String, dynamic> _leaveRequest() => {
      'id': 'lr1',
      'employee_id': 'e1',
      'employee_name': 'Asha Rao',
      'employee_code': 'EMP001',
      'leave_type_id': 't1',
      'leave_name': 'Casual Leave',
      'leave_code': 'CL',
      'start_date': '2026-11-12T00:00:00.000Z',
      'end_date': '2026-11-13T00:00:00.000Z',
      'total_days': '2.00',
      'status': 'pending',
      'reason': 'Family function',
      'created_at': '2026-11-09T05:00:00.000Z',
    };

void registerHr(WalkFixtures f) {
  final asha = _employee('e1', 'Asha Rao', 'EMP001');
  final ravi = _employee('e2', 'Ravi Kumar', 'EMP002');
  f.get('/api/employees', walkList([asha, ravi], ['employees'], {'scope': 'all'}));
  f.get('/api/employees/login-options', {
    'roles': [
      {'id': 'r1', 'name': 'Accountant', 'role_name': 'Accountant', 'role_key': 'accountant'},
    ],
    'canAssignLogin': true,
    'seats': {'used': 2, 'limit': 5},
  });
  f.get('/api/employees/org-chart', {
    'roots': [
      {'id': 'e1', 'name': 'Asha Rao', 'employee_code': 'EMP001', 'designation': 'Manager', 'department': 'Sales', 'children': [
        {'id': 'e2', 'name': 'Ravi Kumar', 'employee_code': 'EMP002', 'designation': 'Sales', 'department': 'Sales', 'children': <Object>[]},
      ]},
    ],
    'orphans': <Object>[],
    'departments': ['Sales'],
    'employee_count': 2,
  });
  f.get('/api/employees/:id', {
    'employee': asha,
    'documents': <Object>[],
  });
  f.get('/api/employees/leave-requests', {
    'requests': [_leaveRequest()],
  });
  f.get('/api/employees/leave-balances', {
    'balances': [
      {'id': 'lb1', 'employee_id': 'e1', 'leave_type_id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL', 'opening_balance': '12', 'used_days': '2', 'current_balance': '10', 'carry_forward_days': '0', 'earned_days': '12'},
    ],
  });
  f.get('/api/employees/leave-calendar', {
    'leaves': [
      {
        'event_kind': 'leave',
        'id': 'lr1',
        'employee_id': 'e1',
        'start_date': '2026-11-12T00:00:00.000Z',
        'end_date': '2026-11-12T00:00:00.000Z',
        'total_days': '1.00',
        'status': 'approved',
        'leave_name': 'Casual Leave',
        'employee_code': 'EMP001',
        'employee_name': 'Asha Rao',
      },
    ],
    'calendar': <Object>[],
    'attendance': [
      {'event_kind': 'attendance', 'id': 'at1', 'employee_id': 'e2', 'date': '2026-11-05', 'status': 'absent', 'employee_code': 'EMP002', 'employee_name': 'Ravi Kumar'},
    ],
    'attendance_calendar': <Object>[],
  });
  f.get('/api/leave-types', {
    'leave_types': [
      {'id': 't1', 'leave_name': 'Casual Leave', 'leave_code': 'CL', 'is_active': true},
    ],
  });
  f.get('/api/hr/leave/preview-days', {'total_days': 2, 'days': 2, 'sandwich_days': 0});
  f.get('/api/employees/attendance/matrix', {
    'month': '2026-11',
    'days': [
      {'date': '2026-11-02', 'day': 2, 'weekday': 'Mon', 'isSunday': false},
      {'date': '2026-11-03', 'day': 3, 'weekday': 'Tue', 'isSunday': false},
    ],
    'workers': [
      {
        'id': 'e1',
        'code': 'EMP1',
        'name': 'Asha Rao',
        'cells': [_cell('present', 'P', hours: 8, code: 'P'), _cell('absent', 'A', code: 'A')],
        'days': 1,
        'totalHoursLabel': '8h',
      },
    ],
  });
  f.get('/api/employees/attendance/reviews', {
    'reviews': [
      {
        'id': 'rv1',
        'employee_id': 'e2',
        'employee_name': 'Ravi Kumar',
        'employee_code': 'EMP002',
        'attendance_date': '2026-11-05',
        'status': 'pending',
        'reasons': ['Outside the shop area'],
        'photos': <Object>[],
        'risk_score': 40,
        'distance_m': 320,
        'site_name': 'Main shop',
        'wifi_matched': false,
        'face_similarity': 0.7,
        'created_at': '2026-11-05T05:00:00.000Z',
      },
    ],
  });
  f.get('/api/employees/manager/attendance', {
    'date': '2026-11-10',
    'scope': 'team',
    'team': [
      {'employee_id': 'e1', 'id': 'e1', 'employee_name': 'Asha Rao', 'name': 'Asha Rao', 'employee_code': 'EMP001', 'status': 'present', 'check_in': '2026-11-10T04:00:00.000Z', 'check_out': null, 'hours': 4},
    ],
    'employees': [
      {'employee_id': 'e1', 'id': 'e1', 'employee_name': 'Asha Rao', 'name': 'Asha Rao', 'employee_code': 'EMP001', 'status': 'present'},
    ],
  });
  f.get('/api/employees/manager/dashboard', {
    'team_count': 2,
    'pending_leaves': 1,
    'pending_expenses': 1,
    'present_today': 1,
    'absent_today': 1,
    'pending_approvals': 3,
  });
  f.get('/api/employees/manager/team', {
    'team': [asha, ravi],
    'employees': [asha, ravi],
  });
  f.get('/api/employees/manager/pending-approvals', {
    'leaves': [
      {..._leaveRequest(), 'leave_request_id': 'lr1', 'approval_level': 1, 'can_act_on_step': true, 'leave_chain': <Object>[]},
    ],
    'expenses': [
      {'id': 'x1', 'employee_id': 'e1', 'employee_name': 'Asha Rao', 'category': 'Travel', 'category_name': 'Travel', 'amount': '450.00', 'description': 'Cab', 'expense_date': '2026-11-08', 'status': 'pending'},
    ],
    'overtime': <Object>[],
    'regularizations': <Object>[],
    'exits': <Object>[],
    'approvals': <Object>[],
  });
  f.get('/api/employees/salary/payments', {
    'payments': [
      {
        'id': 'sp1',
        'employee_id': 'e1',
        'employee_name': 'Asha Rao',
        'employee_code': 'EMP001',
        'payment_date': '2026-10-31',
        'period_start': '2026-10-01',
        'period_end': '2026-10-31',
        'gross_salary': '25000.00',
        'net_salary': '23500.00',
        'total_deductions': '1500.00',
        'amount': '23500.00',
        'status': 'paid',
        'payment_method': 'bank',
        'receipt_url': null,
      },
    ],
  });
  f.get('/api/employees/salary/payments/prefill', {
    'gross_salary': 25000,
    'net_salary': 23500,
    'total_deductions': 1500,
    'attendance_deduction': 0,
    'advance_recoveries': <Object>[],
    'component_breakdown': <Object>[],
    'pro_rata': false,
    'fields': <String, dynamic>{},
  });
  f.get('/api/employees/salary/advances', {
    'advances': [
      {'id': 'sa1', 'employee_id': 'e1', 'employee_name': 'Asha Rao', 'employee_code': 'EMP001', 'advance_amount': '5000.00', 'amount': '5000.00', 'advance_date': '2026-10-05', 'recovered_amount': '1000.00', 'remaining_amount': '4000.00', 'status': 'approved', 'reason': 'Medical'},
    ],
  });
  f.get('/api/employees/salary/advances/balance', {'pending_balance': 4000, 'suggested_recovery': 1000});
  f.get('/api/employees/commissions', {
    'commissions': [
      {'id': 'cm1', 'employee_id': 'e1', 'employee_name': 'Asha Rao', 'invoice_number': 'INV-035', 'invoice_date': '2026-11-01', 'sale_amount': '5000.00', 'commission_rate': '2.00', 'commission_amount': '100.00', 'status': 'pending'},
    ],
    'totals': {'pending': 100, 'approved': 0, 'paid': 0, 'total': 100},
  });
  f.get('/api/employees/expenses', {
    'expenses': [
      {'id': 'x1', 'employee_id': 'e1', 'employee_name': 'Asha Rao', 'employee_code': 'EMP001', 'category_name': 'Travel', 'amount': '450.00', 'description': 'Cab', 'expense_date': '2026-11-08', 'status': 'pending', 'vendor_name': 'Ola', 'receipt_url': null},
    ],
    'totals': {'pending': 450, 'approved': 0, 'reimbursed': 0, 'total': 450},
  });
  f.get('/api/employees/targets', {
    'targets': [
      {'id': 'tg1', 'employee_id': 'e1', 'employee_name': 'Asha Rao', 'target_month': 11, 'target_year': 2026, 'target_amount': '100000.00', 'target_invoices': 20, 'target_period': 'monthly', 'achievement_percentage': 40},
    ],
  });
  f.get('/api/employees/targets/:id', {
    'target': {'id': 'tg1', 'employee_id': 'e1', 'target_amount': '100000.00'},
  });
  f.get('/api/employees/performance', {
    'performance': [
      {'employee_id': 'e1', 'employee_name': 'Asha Rao', 'employee_code': 'EMP001', 'total_sales': 40000, 'total_invoices': 8, 'average_invoice_value': 5000, 'total_commission': 800, 'target_amount': 100000, 'achievement_percentage': 40},
    ],
    'summary': {'totalSales': 40000, 'totalInvoices': 8, 'totalCommission': 800, 'totalEmployees': 1},
  });
  f.get('/api/tasks', {
    'tasks': [
      {'id': 'k1', 'title': 'Count stock', 'description': 'Aisle 3', 'status': 'pending', 'priority': 'high', 'due_date': '2026-11-15', 'assigned_to': 'e1', 'assignee_name': 'Asha Rao'},
      {'id': 'k2', 'title': 'Clean shelves', 'description': null, 'status': 'completed', 'priority': 'low', 'due_date': null, 'assigned_to': null, 'assignee_name': null},
    ],
  });
  f.get('/api/hr/dashboard/overview', {
    'headcount': 12,
    'pending_invites': 2,
    'pending_leaves': 3,
    'present_today': 8,
    'absent_today': 4,
    'in_probation': 1,
    'pending_exit_approvals': 1,
    'active_announcements': 5,
    'birthdays_this_week': 2,
    'new_joiners_this_month': 3,
    'date': '11 Nov 2026',
    'notifications': [
      {'type': 'exits', 'label': 'Exit approvals pending', 'count': 1, 'href': '/hr/exits'},
    ],
  });
  f.get('/api/hr/announcements', {
    'announcements': [
      {'id': 'a1', 'title': 'Diwali holiday', 'body': 'Shop closed on 12 Nov', 'author_name': 'HR', 'published_at': '2026-11-09 10:00:00+00', 'expires_at': null, 'audience': {'type': 'all'}, 'is_published': true},
    ],
  });
  f.get('/api/hr/engagement/polls', {
    'polls': [
      {'id': 'p1', 'question': 'Lunch place?', 'audience': {'type': 'departments', 'departments': ['Sales']}, 'allow_multiple': false, 'expires_at': null, 'is_active': true, 'options': [
        {'id': 'o1', 'text': 'Canteen', 'label': 'Canteen', 'votes': 3},
      ]},
    ],
  });
  f.get('/api/hr/engagement/articles', {
    'articles': [
      {'id': 'r1', 'title': 'Safety tips', 'body_html': '<p>Wear <b>gloves</b></p>', 'author_name': null, 'allow_employee_posts': false, 'published_at': '2026-11-07 09:00:00+00'},
    ],
  });
  f.get('/api/hr/exits', {
    'exits': [
      {'id': 'x1', 'employee_id': 'e2', 'employee_name': 'Ravi Kumar', 'employee_code': 'EMP002', 'exit_type': 'resignation', 'status': 'pending', 'reason': 'Relocation', 'notice_period_days': 30, 'last_working_day': '2026-12-10', 'fnf_status': 'pending', 'created_at': '2026-11-01T05:00:00.000Z'},
    ],
  });
  f.get('/api/hr/exits/:id', {
    'exit': {'id': 'x1', 'employee_id': 'e2', 'employee_name': 'Ravi Kumar', 'exit_type': 'resignation', 'status': 'pending', 'reason': 'Relocation'},
    'approvals': <Object>[],
  });
  f.get('/api/hr/recruitment/jobs', {
    'jobs': [
      {'id': 'j1', 'title': 'Sales executive', 'job_title': 'Sales executive', 'department': 'Sales', 'status': 'open', 'candidate_count': 2, 'created_at': '2026-11-01T05:00:00.000Z'},
    ],
  });
  f.get('/api/hr/recruitment/jobs/:id', {
    'job': {'id': 'j1', 'title': 'Sales executive', 'department': 'Sales', 'status': 'open'},
    'candidates': [
      {'id': 'cd1', 'candidate_name': 'Meera Joshi', 'name': 'Meera Joshi', 'stage_name': 'Interview', 'status': 'active', 'email': 'meera@example.com', 'phone': '9876543210'},
    ],
  });
  f.get('/api/hr/recruitment/candidates', {
    'candidates': [
      {'id': 'cd1', 'candidate_name': 'Meera Joshi', 'name': 'Meera Joshi', 'job_title': 'Sales executive', 'stage_name': 'Interview', 'status': 'active', 'email': 'meera@example.com', 'phone': '9876543210'},
    ],
  });
  f.get('/api/hr/recruitment/candidates/:id', {
    'candidate': {'id': 'cd1', 'candidate_name': 'Meera Joshi', 'name': 'Meera Joshi', 'job_title': 'Sales executive', 'stage_name': 'Interview', 'status': 'active'},
    'offer_approvals': <Object>[],
    'interviews': <Object>[],
    'notes': <Object>[],
  });
  f.get('/api/hr/recruitment/offer-approvals/pending', {'approvals': <Object>[]});
  f.get('/api/hr/shifts/roster', {
    'days': ['2026-11-09', '2026-11-10'],
    'shifts': [
      {'id': 'sh1', 'name': 'Morning', 'start_time': '09:00', 'end_time': '17:00'},
    ],
    'employees': [
      {'id': 'e1', 'name': 'Asha Rao', 'employee_code': 'EMP001', 'department': 'Sales', 'assignments': <Object>[]},
    ],
    'settings': {},
  });
  f.get('/api/shifts', {
    'shifts': [
      {'id': 'sh1', 'name': 'Morning', 'start_time': '09:00', 'end_time': '17:00', 'is_active': true},
    ],
  });
  f.get('/api/hr/document-templates', {
    'templates': [
      {'id': 'dt1', 'name': 'Experience letter', 'document_type': 'experience_letter', 'is_active': true, 'description': 'For leavers'},
    ],
    'attributes': <Object>[],
  });
  f.get('/api/hr/onboarding-templates', {
    'templates': [
      {'id': 'ot1', 'name': 'Day one', 'tasks': <Object>[]},
    ],
  });
  f.get('/api/hr/reports/:id', {
    'rows': [
      {'employee_id': 'e1', 'employee_name': 'Asha Rao', 'employee_code': 'EMP001', 'department': 'Sales', 'value': 10},
    ],
    'summary': {'total': 10},
    'columns': [
      {'key': 'employee_name', 'label': 'Employee'},
      {'key': 'value', 'label': 'Value'},
    ],
    'title': 'Report',
  });
  f.get('/api/settings/hr-org-catalog', {
    'catalog': {'departments': ['Sales', 'Stores'], 'designations': ['Manager', 'Sales']},
  });
  f.get('/api/settings/hr-approval', {'settings': {'offer_min_levels': 1, 'offer_max_levels': 2}});
  f.get('/api/settings/hr-exit', {'settings': {'exit_reasons': ['Better opportunity', 'Relocation']}});
  f.get('/api/settings/attendance-policy', {'policy': {'late_detection_mode': 'both', 'grace_minutes': 10, 'free_lates_per_month': 2}});
  f.get('/api/settings/ot-policy', {'policy': {'notice_hours': 4}});
  f.get('/api/settings/attendance-regularization', {'settings': {'max_days_back': 7}});
  f.get('/api/settings/leave-plan', {'plan': {'leave_year_start_month': 4}});
  f.get('/api/settings/hr-payroll', {'settings': {'pay_day': 1}});
  f.get('/api/settings/hr-portal', {'settings': {'portal_enabled': true}});
  f.get('/api/settings/hr-employee', {'settings': {'probation_days': 90}});
  f.get('/api/settings/weekly-off', {
    'settings': {'weekly_off_days': [0]},
    'weekly_off': {'fixed_days': [0], 'nth_rules': <Object>[]},
    'fixed_days': [0],
    'nth_rules': <Object>[],
  });
  f.get('/api/settings/holiday-lists', {
    'lists': [
      {'id': 'hl1', 'name': 'National 2026', 'year': 2026, 'holidays': [
        {'id': 'h1', 'date': '2026-11-12', 'name': 'Diwali'},
      ]},
    ],
    'holidayLists': <Object>[],
  });
  f.get('/api/settings/salary-components', {
    'components': [
      {'id': 'sc1', 'name': 'Basic', 'component_type': 'earning', 'calculation_type': 'percent', 'value': 50, 'is_active': true},
    ],
  });
  f.get('/api/settings/offer-letter-template', {'template': {'body': 'Dear {{name}}'}, 'settings': {}});
  f.get('/api/commission-rules', {
    'rules': [
      {'id': 'cr1', 'name': 'Standard', 'commission_rate': '2.00', 'rate': '2.00', 'applies_to': 'all', 'is_active': true},
    ],
  });
}
