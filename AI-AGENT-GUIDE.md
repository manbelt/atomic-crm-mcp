# Atomic CRM - AI Agent Integration Guide

## Access Details

### CRM Frontend
- **URL**: https://atomic-crm-nine.vercel.app
- **Purpose**: Web interface for human users

### MCP Server
- **URL**: https://atomic-crm-mcp.vercel.app
- **MCP Endpoint**: https://atomic-crm-mcp.vercel.app/mcp
- **Purpose**: AI agent integration via Model Context Protocol

### Authentication Credentials
- **Email**: c.anivell@gmail.com
- **Password**: AtomicCRM2024!

### Supabase Project
- **Project Ref**: dapqcnlbilcpwwlwivvj
- **Project URL**: https://dapqcnlbilcpwwlwivvj.supabase.co

---

## MCP Server Capabilities

The Atomic CRM MCP server provides **18 tools** for full CRUD operations on your CRM data.

### Quick Reference

| Category | Tools | Count |
|----------|-------|-------|
| **Read** | get_schema, query, search_contacts, get_summary | 4 |
| **Create** | create_contact, create_deal, create_task, create_company, create_note | 5 |
| **Update** | update_contact, update_deal, update_task, update_company | 4 |
| **Delete** | delete_contact, delete_deal, delete_task, delete_company | 4 |

---

## Tool Documentation

### READ Operations

#### 1. `get_schema`
Returns the database schema to help construct accurate SQL queries.

**Parameters**: None

**Returns**: 
- Table names and columns
- Data types
- Foreign key relationships
- Primary keys

**Example Use Case**:
> "What tables are available in the CRM?"
> "Show me the database structure"

---

#### 2. `query`
Execute SQL SELECT queries against the CRM database.

**Parameters**:
- `sql` (string): The SQL SELECT query to execute

**Security**: 
- Read-only (SELECT statements only)
- Row Level Security enforced
- Only returns data owned by the authenticated user

**Example Queries**:
```sql
-- Get all contacts
SELECT * FROM contacts_summary

-- Get deals by stage
SELECT stage, COUNT(*), SUM(amount) FROM deals GROUP BY stage

-- Get recent tasks
SELECT * FROM tasks WHERE status = 'pending' ORDER BY due_date

-- Get contacts with their company
SELECT c.first_name, c.last_name, co.name as company
FROM contacts c
LEFT JOIN companies co ON c.company_id = co.id

-- Get deal notes
SELECT d.name, dn.text, dn.created_at
FROM deals d
JOIN dealNotes dn ON dn.deal_id = d.id
```

**Example Use Cases**:
> "Show me all contacts in the technology industry"
> "What deals are in the proposal stage?"
> "Get all tasks due this week"
> "Show me the total value of deals won this month"

---

#### 3. `search_contacts`
Search for contacts by name, email, or company.

**Parameters**:
- `query` (string, required): Search term
- `limit` (number, optional): Max results (default: 10, max: 50)

**Returns**: Array of matching contacts with:
- id, first_name, last_name
- email, phone, title
- company_name, status

**Example Use Cases**:
> "Find contact named John"
> "Search for contacts at Google"
> "Find contacts with email containing @tech.com"

---

#### 4. `get_summary`
Get dashboard summary statistics for the CRM.

**Parameters**: None

**Returns**:
- Total contacts count
- Total deals count
- Total deals value
- Deals by stage
- Pending tasks count
- Recent activity summary

**Example Use Cases**:
> "Give me a summary of my CRM"
> "What's the current state of my pipeline?"
> "How many contacts do I have?"

---

### CREATE Operations

#### 5. `create_contact`
Create a new contact in the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `first_name` | string | ✅ | Contact's first name (1-100 chars) |
| `last_name` | string | ✅ | Contact's last name (1-100 chars) |
| `email` | string | ❌ | Primary email address |
| `phone` | string | ❌ | Primary phone number |
| `title` | string | ❌ | Job title/position |
| `company_id` | number | ❌ | ID of associated company |
| `linkedin_url` | string | ❌ | LinkedIn profile URL |
| `background` | string | ❌ | Background notes |
| `status` | string | ❌ | Status: lead, active, inactive (default: lead) |
| `gender` | string | ❌ | Contact's gender |
| `has_newsletter` | boolean | ❌ | Newsletter subscription (default: false) |
| `tags` | array | ❌ | Array of tag IDs |

**Example**:
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john.doe@example.com",
  "title": "CEO",
  "company_id": 5,
  "status": "lead"
}
```

**Example Use Cases**:
> "Create a new contact named Jane Smith with email jane@company.com"
> "Add a lead contact for John Doe at Microsoft"

---

#### 6. `create_deal`
Create a new deal/opportunity in the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | ✅ | Deal name/title (1-200 chars) |
| `company_id` | number | ❌ | ID of associated company |
| `contact_ids` | array | ❌ | Array of contact UUIDs (max 10) |
| `stage` | string | ❌ | Stage: opportunity, proposal, negotiation, closed-won, closed-lost (default: opportunity) |
| `amount` | number | ❌ | Deal amount in cents |
| `expected_close_date` | string | ❌ | Expected close date (YYYY-MM-DD) |
| `description` | string | ❌ | Deal description |
| `probability` | number | ❌ | Win probability 0-100 |

**Example**:
```json
{
  "name": "Enterprise License Deal",
  "company_id": 5,
  "contact_ids": ["uuid-1", "uuid-2"],
  "stage": "proposal",
  "amount": 500000,
  "probability": 60
}
```

**Example Use Cases**:
> "Create a deal called 'Enterprise Contract' worth $50,000"
> "Add a new opportunity for Microsoft with 70% probability"

---

#### 7. `create_task`
Create a new task in the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | ✅ | Task title (1-200 chars) |
| `description` | string | ❌ | Task description |
| `contact_id` | string | ❌ | Contact UUID to associate |
| `due_date` | string | ❌ | Due date (ISO 8601 format) |
| `status` | string | ❌ | Status: pending, in-progress, completed, cancelled (default: pending) |
| `priority` | string | ❌ | Priority: low, medium, high, urgent (default: medium) |
| `assignee_id` | string | ❌ | User UUID to assign |

**Example**:
```json
{
  "title": "Follow up with client",
  "contact_id": "uuid-here",
  "due_date": "2024-12-31",
  "priority": "high"
}
```

**Example Use Cases**:
> "Create a task to call John Doe tomorrow"
> "Add a high priority task to send proposal to Microsoft"

---

#### 8. `create_company`
Create a new company in the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | ✅ | Company name (1-200 chars) |
| `website` | string | ❌ | Company website URL |
| `phone` | string | ❌ | Main phone number |
| `address` | string | ❌ | Street address |
| `city` | string | ❌ | City |
| `state` | string | ❌ | State/Province |
| `country` | string | ❌ | Country |
| `zip_code` | string | ❌ | Postal/ZIP code |
| `industry` | string | ❌ | Industry sector |
| `size` | string | ❌ | Company size (e.g., '1-10', '11-50') |
| `revenue` | number | ❌ | Annual revenue in dollars |
| `description` | string | ❌ | Company description |
| `linkedin_url` | string | ❌ | LinkedIn company page URL |
| `twitter_url` | string | ❌ | Twitter/X profile URL |
| `facebook_url` | string | ❌ | Facebook page URL |

**Example**:
```json
{
  "name": "Tech Innovations Inc",
  "website": "https://techinnovations.com",
  "industry": "Technology",
  "size": "51-200",
  "country": "United States"
}
```

**Example Use Cases**:
> "Create a company called 'Acme Corp' in the Technology industry"
> "Add a new company with website https://example.com"

---

#### 9. `create_note`
Create a note attached to a contact or deal.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | ✅ | Note content (1-10000 chars) |
| `contact_id` | string | ❌* | Contact UUID |
| `deal_id` | number | ❌* | Deal ID |
| `type` | string | ❌ | Type: general, call, meeting, email (default: general) |

*At least one of `contact_id` or `deal_id` is required.

**Example**:
```json
{
  "content": "Had a great discovery call. Client is interested in enterprise plan.",
  "contact_id": "uuid-here",
  "type": "call"
}
```

**Example Use Cases**:
> "Add a note to contact John about our meeting"
> "Create a call note for deal #123 saying the client wants to proceed"

---

### UPDATE Operations

#### 10. `update_contact`
Update an existing contact.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | ✅ | Contact UUID to update |
| `first_name` | string | ❌ | Updated first name |
| `last_name` | string | ❌ | Updated last name |
| `email` | string | ❌ | Updated email |
| `phone` | string | ❌ | Updated phone |
| `title` | string | ❌ | Updated job title |
| `company_id` | number | ❌ | Updated company ID |
| `linkedin_url` | string | ❌ | Updated LinkedIn URL |
| `background` | string | ❌ | Updated background notes |
| `status` | string | ❌ | Updated status |
| `gender` | string | ❌ | Updated gender |
| `has_newsletter` | boolean | ❌ | Updated newsletter status |
| `tags` | array | ❌ | Updated tag IDs |

**Example**:
```json
{
  "id": "uuid-here",
  "status": "active",
  "title": "VP of Engineering"
}
```

**Example Use Cases**:
> "Update John Doe's status to active"
> "Change Jane's job title to CTO"

---

#### 11. `update_deal`
Update an existing deal.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Deal ID to update |
| `name` | string | ❌ | Updated deal name |
| `company_id` | number | ❌ | Updated company ID |
| `contact_ids` | array | ❌ | Updated contact UUIDs |
| `stage` | string | ❌ | Updated stage |
| `amount` | number | ❌ | Updated amount |
| `expected_close_date` | string | ❌ | Updated close date |
| `description` | string | ❌ | Updated description |
| `probability` | number | ❌ | Updated probability |

**Example**:
```json
{
  "id": 123,
  "stage": "negotiation",
  "probability": 80
}
```

**Example Use Cases**:
> "Move deal #123 to negotiation stage"
> "Update the probability of deal #456 to 90%"

---

#### 12. `update_task`
Update an existing task.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Task ID to update |
| `title` | string | ❌ | Updated title |
| `description` | string | ❌ | Updated description |
| `contact_id` | string | ❌ | Updated contact UUID |
| `due_date` | string | ❌ | Updated due date |
| `status` | string | ❌ | Updated status |
| `priority` | string | ❌ | Updated priority |
| `assignee_id` | string | ❌ | Updated assignee |

**Example**:
```json
{
  "id": 123,
  "status": "completed"
}
```

**Example Use Cases**:
> "Mark task #123 as completed"
> "Change the due date of task #456 to next Friday"

---

#### 13. `update_company`
Update an existing company.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Company ID to update |
| `name` | string | ❌ | Updated name |
| `website` | string | ❌ | Updated website |
| `phone` | string | ❌ | Updated phone |
| `address` | string | ❌ | Updated address |
| `city` | string | ❌ | Updated city |
| `state` | string | ❌ | Updated state |
| `country` | string | ❌ | Updated country |
| `zip_code` | string | ❌ | Updated ZIP code |
| `industry` | string | ❌ | Updated industry |
| `size` | string | ❌ | Updated size |
| `revenue` | number | ❌ | Updated revenue |
| `description` | string | ❌ | Updated description |
| `linkedin_url` | string | ❌ | Updated LinkedIn URL |
| `twitter_url` | string | ❌ | Updated Twitter URL |
| `facebook_url` | string | ❌ | Updated Facebook URL |

**Example**:
```json
{
  "id": 123,
  "industry": "FinTech",
  "size": "201-500"
}
```

**Example Use Cases**:
> "Update Acme Corp's industry to FinTech"
> "Change the company size for Tech Inc to 51-200"

---

### DELETE Operations

#### 14. `delete_contact`
Delete a contact from the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | ✅ | Contact UUID to delete |

**Effects**:
- Deletes the contact
- Deletes all associated notes
- Removes contact from any deal associations

**Example**:
```json
{
  "id": "uuid-here"
}
```

**Example Use Cases**:
> "Delete contact John Doe"
> "Remove the contact with ID abc-123"

---

#### 15. `delete_deal`
Delete a deal from the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Deal ID to delete |

**Effects**:
- Deletes the deal
- Deletes all associated notes
- Removes contact associations

**Example**:
```json
{
  "id": 123
}
```

**Example Use Cases**:
> "Delete deal #123"
> "Remove the lost deal from the pipeline"

---

#### 16. `delete_task`
Delete a task from the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Task ID to delete |

**Example**:
```json
{
  "id": 123
}
```

**Example Use Cases**:
> "Delete task #123"
> "Remove the cancelled task"

---

#### 17. `delete_company`
Delete a company from the CRM.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Company ID to delete |

**Restrictions**:
- Cannot delete if contacts are associated
- Cannot delete if deals are associated
- Must remove/reassign contacts and deals first

**Example**:
```json
{
  "id": 123
}
```

**Example Use Cases**:
> "Delete company Acme Corp"
> "Remove the duplicate company entry"

---

## Database Schema Reference

### Core Tables

| Table | Description | Key Fields |
|-------|-------------|------------|
| `contacts` | Contact records | id (UUID), first_name, last_name, email_jsonb, phone_jsonb, company_id, status |
| `companies` | Company records | id, name, industry, size, website |
| `deals` | Deal/opportunity records | id, name, stage, amount, probability, company_id |
| `tasks` | Task records | id, title, status, priority, due_date, contact_id |
| `contactNotes` | Notes on contacts | id, contact_id, text, type |
| `dealNotes` | Notes on deals | id, deal_id, text, type |
| `sales` | User/sales rep records | id, user_id |

### Summary Views

| View | Description |
|------|-------------|
| `contacts_summary` | Contacts with computed fields |
| `companies_summary` | Companies with computed fields |
| `deals_summary` | Deals with computed fields |

### Relationship Tables

| Table | Description |
|-------|-------------|
| `deal_contacts` | Many-to-many relationship between deals and contacts |

---

## Connecting Your AI Agent

### Option 1: Claude Desktop

1. Open Settings → Extensions
2. Click "Add a custom Extension"
3. Enter:
   - Name: `Atomic CRM`
   - URL: `https://atomic-crm-mcp.vercel.app/mcp`
4. Click "Add" then "Connect"
5. Authenticate with your credentials

### Option 2: Claude Code (CLI)

```bash
claude mcp add atomic-crm --transport http https://atomic-crm-mcp.vercel.app/mcp
```

Then authenticate when prompted.

### Option 3: VS Code

1. Open Command Palette (Ctrl+Shift+P)
2. Run "MCP: Add Server..."
3. Choose "HTTP"
4. Enter URL: `https://atomic-crm-mcp.vercel.app/mcp`
5. Name it `atomic-crm`
6. Authenticate when prompted

### Option 4: ChatGPT

1. Enable Developer Mode in Settings → Apps → Advanced
2. Go to Settings → Apps → Connectors
3. Click "Create"
4. Enter:
   - Name: `Atomic CRM`
   - MCP Server URL: `https://atomic-crm-mcp.vercel.app/mcp`
   - Authentication: OAuth
5. Authenticate with your credentials

---

## Example Conversations

### Pipeline Management
```
User: "What's the status of my sales pipeline?"

AI: [Uses get_summary]
Your pipeline currently has:
- 45 total contacts
- 12 deals worth $245,000 total
- 3 deals in negotiation stage
- 8 pending tasks

Would you like me to provide more details on any specific area?
```

### Contact Management
```
User: "Add a new contact named Sarah Johnson from Microsoft. She's the VP of Product."

AI: [Uses create_contact]
Created contact:
- Name: Sarah Johnson
- Title: VP of Product
- Company: Microsoft
- Status: lead

Would you like me to create a follow-up task for this new contact?
```

### Deal Tracking
```
User: "Move the Microsoft deal to negotiation and set probability to 75%"

AI: [Uses update_deal]
Updated deal:
- Name: Microsoft Enterprise License
- Stage: negotiation
- Probability: 75%

The deal is now in the negotiation stage with an estimated 75% chance of closing.
```

### Task Management
```
User: "Create a task to follow up with Sarah Johnson next week"

AI: [Uses create_task]
Created task:
- Title: Follow up with Sarah Johnson
- Due: 2024-12-30
- Priority: medium
- Status: pending

I've scheduled the follow-up task for next week.
```

---

## Security Notes

1. **Row Level Security**: All queries are filtered by user ownership
2. **Parameterized Queries**: All inputs are sanitized to prevent SQL injection
3. **JWT Validation**: All requests require valid authentication
4. **Ownership Verification**: Update/Delete operations verify the user owns the record

---

## Troubleshooting

### "Contact not found or access denied"
- The contact doesn't exist
- The contact belongs to another user
- Verify the UUID is correct

### "Cannot delete company: X contacts are associated"
- Remove or reassign contacts first
- Use `update_contact` to set `company_id` to null

### "No fields provided to update"
- Include at least one field to update in the request

---

## Support

- **CRM Frontend**: https://atomic-crm-nine.vercel.app
- **MCP Server**: https://atomic-crm-mcp.vercel.app
- **Repository**: https://github.com/manbelt/atomic-crm-mcp
