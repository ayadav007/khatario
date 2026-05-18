# User Management System - Complete Guide

## Overview

The User Management System allows business owners to add team members (Sales, Accountant, Inventory Manager, etc.) with role-based permissions. Each user can login with their phone number and password, and their access is controlled by granular permissions.

---

## 🚀 Getting Started

### Step 1: Run the Migration

First, run the database migration to set up all necessary tables:

```bash
node scripts/run_migration.js database/migrations/019_user_management_system.sql
```

This migration creates:
- `user_roles` - Stores roles (Primary Admin, Sales, Accountant, etc.)
- `permission_modules` - Defines modules (Invoices, Purchases, Customers, etc.)
- `role_permissions` - Links roles to permissions
- `user_activity_logs` - Tracks all user actions
- `business_settings` - Stores user management toggle

### Step 2: Enable User Management

1. Login as the business owner (Primary Admin)
2. Go to **Settings** → **Users & Roles**
3. Toggle **User Roles & Permissions** to **ON**

### Step 3: Add Your First Team Member

1. Click **Manage Users** → **Add New User**
2. Fill in:
   - User Name
   - Phone Number (they'll use this to login)
   - Email (optional)
   - Password (they'll use this to login)
   - Role (Sales, Accountant, Inventory Manager)
3. Click **Create User**

---

## 📋 Default Roles & Permissions

### 1. **Primary Admin** (Business Owner)
- **Full Access** to everything
- Cannot be deleted or modified
- Can add/edit users and roles

### 2. **Sales**
- ✅ View Dashboard
- ✅ Create & Edit Invoices
- ✅ Create Credit Notes
- ✅ Add & Edit Customers
- ✅ View Items
- ✅ Record Payments
- ❌ Cannot delete anything

### 3. **Accountant**
- ✅ View Dashboard
- ✅ Edit Invoices
- ✅ Manage Credit Notes
- ✅ Manage Customers
- ✅ Edit Purchases
- ✅ Manage Purchase Returns
- ✅ Manage Suppliers
- ✅ Manage Payments
- ✅ View Reports
- ❌ Cannot delete

### 4. **Inventory Manager**
- ✅ View Dashboard
- ✅ Manage Purchases
- ✅ Manage Purchase Returns
- ✅ Manage Suppliers
- ✅ Full control over Items (add/edit/delete)
- ❌ No access to sales or payments

---

## 🔐 How Login Works

### For Sub-Users (Team Members):
1. Go to **khatario.in**
2. Enter their **phone number**
3. Enter their **password** (set by admin)
4. Automatically logged into the business

### For Primary Admin (Owner):
1. Same process
2. Has full access to everything
3. Can manage users and permissions

---

## ⚙️ Managing Permissions

### To Edit Role Permissions:
1. Go to **Settings** → **Users & Roles** → **Manage Roles**
2. Select a role from the left sidebar
3. Toggle permissions in the matrix:
   - **View**: Can see the module
   - **Add**: Can create new records
   - **Modify**: Can edit existing records
   - **Delete**: Can delete records
   - **Share**: Can share/export data
4. Click **Save Changes**

### Permission Matrix Example:

| Module | View | Add | Modify | Delete | Share |
|--------|------|-----|--------|--------|-------|
| Invoices | ✅ | ✅ | ✅ | ❌ | ✅ |
| Customers | ✅ | ✅ | ✅ | ❌ | ❌ |
| Items | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 📊 Activity Tracking

### View Activity Logs:
1. Go to **Settings** → **Activity Log**
2. Filter by:
   - Module (Invoices, Purchases, etc.)
   - User (see what each team member did)

### What's Tracked:
- ✅ Invoice creation, edits, deletions
- ✅ Purchase creation, edits, deletions
- ✅ Customer/Supplier additions and updates
- ✅ Payment records
- ✅ User management actions
- ✅ Settings changes

Each log entry shows:
- Who performed the action
- What action was performed
- When it happened
- IP address (for security)

---

## 🛡️ Security Features

### 1. **Password Protection**
- Each user has their own password
- Passwords are stored securely (bcrypt in production)

### 2. **Session Management**
- Auto-logout after 30 minutes of inactivity (configurable)
- Can track last active time for each user

### 3. **Permission Enforcement**
- Permissions checked on every API call
- Frontend UI hides unauthorized actions
- Backend API validates permissions

### 4. **Activity Auditing**
- Full audit trail of all actions
- Can investigate suspicious activity

---

## 🎯 Use Cases

### Scenario 1: Retail Store
**Owner** (Primary Admin):
- Full control

**Salesperson** (Sales Role):
- Creates invoices
- Adds customers
- Records payments
- Cannot access purchases or reports

**Accountant** (Accountant Role):
- Manages all finances
- Views reports
- Cannot delete critical data

---

### Scenario 2: Wholesale Business
**Owner** (Primary Admin):
- Full control

**Purchase Manager** (Inventory Manager Role):
- Manages suppliers
- Creates purchase orders
- Updates inventory
- No access to sales

**Sales Team** (Sales Role):
- Creates invoices
- Manages customers
- Cannot see purchase costs

---

## 🔧 Technical Implementation

### API Endpoints

#### User Management:
- `GET /api/settings/users` - List users
- `POST /api/settings/users` - Create user
- `GET /api/settings/users/[id]` - Get user
- `PATCH /api/settings/users/[id]` - Update user
- `DELETE /api/settings/users/[id]` - Delete user

#### Role Management:
- `GET /api/settings/roles` - List roles with permissions
- `POST /api/settings/roles` - Create custom role
- `PATCH /api/settings/roles/[id]/permissions` - Update permissions

#### Settings:
- `GET /api/settings/user-management` - Get settings
- `PATCH /api/settings/user-management` - Toggle user management

#### Activity Logs:
- `GET /api/settings/activity-logs` - Get activity logs

#### Permissions:
- `GET /api/settings/permissions?user_id=xxx` - Get user permissions

### Frontend Components

#### Pages:
- `/settings` - Main settings hub
- `/settings/users` - Manage users
- `/settings/roles` - Manage roles & permissions
- `/settings/activity` - Activity logs

#### Hooks:
```typescript
import { usePermissions } from '@/hooks/usePermissions';

const { hasPermission, canAdd, canModify, isPrimaryAdmin } = usePermissions();

// Check specific permission
if (hasPermission('invoices', 'add')) {
  // Show "New Invoice" button
}

// Simpler checks
if (canAdd('customers')) {
  // Show "Add Customer" button
}
```

#### Backend Utils:
```typescript
import { hasPermission, requirePermission } from '@/lib/permissions';

// Check permission
const allowed = await hasPermission(userId, 'invoices', 'delete');

// Middleware for API routes
const { allowed, error } = await requirePermission(userId, 'invoices', 'modify');
if (!allowed) {
  return NextResponse.json({ error }, { status: 403 });
}
```

---

## 🎨 UI Features

### User List Page:
- **Green Badge**: Active users
- **Red Badge**: Inactive users
- **Toggle Active/Inactive**: Quick enable/disable
- **Delete Button**: Remove users (except Primary Admin)
- **Role Display**: Shows each user's role

### Role Management Page:
- **Side Panel**: Lists all roles
- **Permission Matrix**: Visual grid for easy editing
- **System Role Lock**: Primary Admin cannot be modified
- **Save Changes**: Updates permissions instantly

### Activity Log Page:
- **Color-Coded Actions**: Green (create), Blue (update), Red (delete)
- **Filter Options**: By module and user
- **Detailed View**: Shows who, what, when, where
- **Pagination**: Handles large logs efficiently

---

## 📝 Best Practices

### 1. **Start Simple**
- Enable user management only when you need multiple users
- Start with default roles (Sales, Accountant)
- Customize permissions later as needed

### 2. **Regular Audits**
- Check activity logs weekly
- Review user access quarterly
- Deactivate unused accounts

### 3. **Strong Passwords**
- Use minimum 8 characters
- Combine letters and numbers
- Don't share passwords

### 4. **Limited Access**
- Give users only the permissions they need
- Use "View Only" for training
- Promote to higher roles gradually

### 5. **Activity Monitoring**
- Watch for unusual patterns
- Track high-value transactions
- Export logs for record-keeping

---

## 🐛 Troubleshooting

### User Can't Login:
1. Check if user is **Active** (not deactivated)
2. Verify phone number is correct
3. Check if **User Management** is enabled
4. Reset password if forgotten

### User Can't See Features:
1. Check their role permissions
2. Verify **View** permission is enabled
3. Try refreshing the page
4. Check browser console for errors

### Permission Changes Not Working:
1. User must logout and login again
2. Clear browser cache
3. Verify permissions were saved
4. Check for database connection issues

---

## 🚀 Future Enhancements

Potential features to add:
- [ ] Custom roles (beyond system roles)
- [ ] Time-based permissions (work hours only)
- [ ] Branch/location-based access
- [ ] Approval workflows
- [ ] SMS OTP for sensitive operations
- [ ] Session management (view active sessions)
- [ ] Bulk user import
- [ ] Permission templates

---

## 📞 Support

If you need help:
1. Check this guide first
2. Review activity logs for errors
3. Test with a dummy user account
4. Contact support with specific error messages

---

## Summary

You now have a complete user management system with:
- ✅ Role-based access control
- ✅ Granular permissions (View/Add/Modify/Delete/Share)
- ✅ Activity logging and auditing
- ✅ Easy-to-use interface
- ✅ Secure authentication
- ✅ Ready for production use

**Next Steps:**
1. Run the migration
2. Enable user management in settings
3. Add your first team member
4. Customize permissions as needed
5. Monitor activity regularly

Happy team collaboration! 🎉

