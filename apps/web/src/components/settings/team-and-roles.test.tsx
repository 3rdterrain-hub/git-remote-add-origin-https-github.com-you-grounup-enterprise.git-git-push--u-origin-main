/**
 * Who is in the company, and what each of them may do.
 *
 * `roles`, `company_memberships` and `company_invitations` had no reader and no
 * writer from migration 0002 until 0211, and this tab rendered eleven roles
 * typed into the JSX with invented user counts beside them.
 *
 * The tests that matter most here are about controls being *refused*: the
 * database is what enforces them, and this screen has to agree with it before
 * somebody clicks rather than after.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompanyMember, CompanyRole, CompanyInvitation } from '@/lib/data/team';

const hoisted = vi.hoisted(() => ({
  members: [] as CompanyMember[],
  roles: [] as CompanyRole[],
  invitations: [] as CompanyInvitation[],
  roleChanges: [] as { membership: string; role: string }[],
  statusChanges: [] as { membership: string; status: string }[],
  created: [] as Record<string, unknown>[],
  invited: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/team', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/team')>('@/lib/data/team');
  return {
    ...actual,
    loadCompanyMembers: async () => hoisted.members,
    loadCompanyRoles: async () => hoisted.roles,
    loadCompanyInvitations: async () => hoisted.invitations,
    setMemberRole: async (membership: string, role: string) => {
      hoisted.roleChanges.push({ membership, role });
    },
    setMemberStatus: async (membership: string, status: string) => {
      hoisted.statusChanges.push({ membership, status });
    },
    createCompanyRole: async (_c: string, role: Record<string, unknown>) => {
      hoisted.created.push(role); return 'r-new';
    },
    inviteMember: async (_c: string, invite: Record<string, unknown>) => {
      hoisted.invited.push(invite);
      return { id: 'i-1', token: 'a'.repeat(64), expiresAt: '2026-10-01T00:00:00Z' };
    },
  };
});

const { TeamMembers } = await import('./team-members');
const { CompanyRoles } = await import('./company-roles');

const role = (over: Partial<CompanyRole> = {}): CompanyRole => ({
  id: 'r-est', key: 'estimator', name: 'Estimator', description: null,
  permissions: ['estimates.read', 'estimates.write'], approvalTier: 1,
  isSystem: true, isEditable: false, memberCount: 3, ...over,
});

const member = (over: Partial<CompanyMember> = {}): CompanyMember => ({
  id: 'm-1', userId: 'u-1', fullName: 'Sam Hand', email: 'sam@co.test', jobTitle: null,
  lastSeenAt: null, roleId: 'r-est', roleKey: 'estimator', roleName: 'Estimator',
  approvalTier: 1, status: 'active', isOwner: false, isMe: false,
  invitedAt: null, joinedAt: null, ...over,
});

beforeEach(() => {
  hoisted.roles = [
    role(),
    role({ id: 'r-view', key: 'viewer', name: 'Viewer', approvalTier: 0, memberCount: 0 }),
    /* Carries a permission the editor in one test below does not hold, which is
       the only way the "cannot grant what you lack" rule has anything to bite on. */
    role({ id: 'r-acct', key: 'accountant', name: 'Accountant', approvalTier: 1,
      permissions: ['finance.read', 'billing.manage'], memberCount: 1 }),
  ];
  hoisted.members = [member()];
  hoisted.invitations = [];
  hoisted.roleChanges = [];
  hoisted.statusChanges = [];
  hoisted.created = [];
  hoisted.invited = [];
});

const showTeam = (canManage = true) =>
  render(<TeamMembers companyId="c-1" canManage={canManage} />);
const showRoles = (perms: string[] = ['*']) =>
  render(<CompanyRoles companyId="c-1" canManage myPermissions={perms} />);

describe('the people', () => {
  it('lists them with the role each actually holds', async () => {
    showTeam();
    await waitFor(() => expect(screen.getByText('Sam Hand')).toBeTruthy());
    expect(screen.getByDisplayValue('Estimator')).toBeTruthy();
  });

  it('changes somebody’s role from the row it is shown on', async () => {
    showTeam();
    await waitFor(() => expect(screen.getByText('Sam Hand')).toBeTruthy());
    await userEvent.selectOptions(screen.getByDisplayValue('Estimator'), 'r-view');
    await waitFor(() => expect(hoisted.roleChanges).toEqual([
      { membership: 'm-1', role: 'r-view' },
    ]));
  });

  it('will not let you change your own role, and says why', async () => {
    /*
     * The database refuses this (0211). If the screen offered it anyway, the
     * person would find out by being told no after deciding to do it.
     */
    hoisted.members = [member({ isMe: true })];
    showTeam();
    await waitFor(() => expect(screen.getByText('You')).toBeTruthy());
    const select = screen.getByDisplayValue('Estimator');
    expect(select).toBeDisabled();
    expect(select.getAttribute('title')).toMatch(/somebody else has to change your role/i);
  });

  it('will not let you suspend your own access', async () => {
    hoisted.members = [member({ isMe: true })];
    showTeam();
    const suspend = await screen.findByRole('button', { name: /suspend/i });
    expect(suspend).toBeDisabled();
    expect(suspend.getAttribute('title')).toMatch(/cannot suspend your own access/i);
  });

  it('suspends somebody else, and offers to restore them', async () => {
    showTeam();
    await userEvent.click(await screen.findByRole('button', { name: /suspend/i }));
    await waitFor(() => expect(hoisted.statusChanges).toEqual([
      { membership: 'm-1', status: 'suspended' },
    ]));

    hoisted.members = [member({ status: 'suspended' })];
    showTeam();
    expect(await screen.findByRole('button', { name: /restore/i })).toBeTruthy();
  });

  it('offers nothing to somebody without permission to manage users', async () => {
    showTeam(false);
    await waitFor(() => expect(screen.getByText('Sam Hand')).toBeTruthy());
    expect(screen.getByRole('button', { name: /invite somebody/i })).toBeDisabled();
    expect(screen.getByDisplayValue('Estimator')).toBeDisabled();
  });
});

describe('an invitation', () => {
  it('shows the link once, and says it cannot be shown again', async () => {
    showTeam();
    await userEvent.click(await screen.findByRole('button', { name: /invite somebody/i }));
    await userEvent.type(screen.getByLabelText(/their email address/i), 'new@co.test');
    await userEvent.click(screen.getByRole('button', { name: /create the invitation/i }));

    await waitFor(() => expect(hoisted.invited).toHaveLength(1));
    expect(screen.getByText(/shown once/i)).toBeTruthy();
    expect(screen.getByText(/cannot be shown again/i)).toBeTruthy();
    /* The honest sentence: nothing was emailed, so nothing claims it was. */
    expect(screen.getByText(/nothing is emailed from here/i)).toBeTruthy();
    expect(screen.getByText(new RegExp('a'.repeat(20)))).toBeTruthy();
  });

  it('says no account is created by inviting somebody', async () => {
    showTeam();
    await userEvent.click(await screen.findByRole('button', { name: /invite somebody/i }));
    expect(screen.getByText(/No account is created/i)).toBeTruthy();
  });
});

describe('the roles', () => {
  it('counts the people holding each role rather than remembering a number', async () => {
    showRoles();
    await waitFor(() => expect(screen.getByText('Estimator')).toBeTruthy());
    const row = screen.getByText('Estimator').closest('tr')!;
    expect(within(row).getByText('3')).toBeTruthy();
    /* A role nobody holds reads as an em dash, not as a zero. */
    const viewer = screen.getByText('Viewer').closest('tr')!;
    expect(within(viewer).getByText('—')).toBeTruthy();
  });

  it('will not offer to edit or remove a shipped role', async () => {
    showRoles();
    await waitFor(() => expect(screen.getByText('Estimator')).toBeTruthy());
    const row = screen.getByText('Estimator').closest('tr')!;
    expect(within(row).getAllByText('Shipped').length).toBeGreaterThan(0);
    expect(within(row).queryAllByRole('button')).toEqual([]);
  });

  it('offers only the permissions the person editing actually holds', async () => {
    /*
     * The escalation 0211 closes: anybody with users.manage can write a role,
     * so without this they could mint one carrying billing.manage and put
     * themselves in it. The database refuses it; the checkbox is disabled so
     * nobody tries.
     */
    showRoles(['estimates.read', 'estimates.write']);
    await userEvent.click(await screen.findByRole('button', { name: /add a role/i }));

    /* finance.read and billing.manage are offered but cannot be ticked. */
    const withheld = screen.getAllByTitle(/you do not hold this permission/i);
    expect(withheld).toHaveLength(2);
    for (const label of withheld) {
      expect(within(label as HTMLElement).getByRole('checkbox')).toBeDisabled();
    }
    const allowed = screen.getAllByRole('checkbox').filter((c) => !(c as HTMLInputElement).disabled);
    expect(allowed).toHaveLength(2);
    expect(screen.getByText(/You can only grant what you hold/i)).toBeTruthy();
  });

  it('refuses to save a role that grants nothing', async () => {
    showRoles();
    await userEvent.click(await screen.findByRole('button', { name: /add a role/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Yard Foreman');
    const save = screen.getByRole('button', { name: /save the role/i });
    expect(save).toBeDisabled();
    expect(save.getAttribute('title')).toMatch(/grants nothing/i);
  });

  it('creates a role with the permissions that were ticked', async () => {
    showRoles();
    await userEvent.click(await screen.findByRole('button', { name: /add a role/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Yard Foreman');
    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /save the role/i }));
    await waitFor(() => expect(hoisted.created).toHaveLength(1));
    expect(hoisted.created[0]!.name).toBe('Yard Foreman');
    expect((hoisted.created[0]!.permissions as string[]).length).toBe(1);
  });
});
