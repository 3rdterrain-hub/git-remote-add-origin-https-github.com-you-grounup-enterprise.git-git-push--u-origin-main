import { useState } from 'react';
import {
  Users2, ShieldAlert, Clock, CheckCircle2, Plus, Lock, AlertTriangle, BadgeCheck,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EMPLOYEES, TIME_ENTRIES } from '@/data/fleet';
import { USER } from '@/data/demo';
import { money, percent, qty, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

export function WorkforcePage() {
  const [entries, setEntries] = useState(TIME_ENTRIES);
  const canApprove = USER.permissions.includes('projects.write');

  const allCredentials = EMPLOYEES.flatMap((e) => e.credentials.map((c) => ({ ...c, employee: e.name, classification: e.classification })));
  const expired = allCredentials.filter((c) => c.status === 'expired');
  const expiring = allCredentials.filter((c) => c.status === 'expiring');

  const pending = entries.filter((t) => t.approvalState === 'pending');
  const exported = entries.filter((t) => t.exported);
  const weekHours = entries.reduce((a, t) => a + t.straight + t.overtime, 0);
  const otHours = entries.reduce((a, t) => a + t.overtime, 0);

  const approve = (id: string) =>
    setEntries((prev) => prev.map((t) => (t.id === id ? { ...t, approvalState: 'approved' as const } : t)));
  const approveAll = () =>
    setEntries((prev) => prev.map((t) => (t.approvalState === 'pending' ? { ...t, approvalState: 'approved' as const } : t)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workforce"
        description="Employees, the credentials that let them do the work, and the time that becomes job cost. A timecard posts to the same cost code the estimate priced."
        actions={<Button><Plus className="size-4" /> Add employee</Button>}
      />

      {expired.length ? (
        <Alert tone="danger" icon={<ShieldAlert className="size-4" />}
          title={`${plural(expired.length, 'credential')} expired`}>
          {expired.map((c) => `${c.employee} — ${c.name}`).join('; ')}. An expired DOT card or CDL is a stop-work
          issue, not a paperwork issue. Status is recomputed against the calendar by the database, so this list
          cannot silently go stale.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active employees" value={EMPLOYEES.length} icon={<Users2 className="size-4" />}
          hint={`${EMPLOYEES.filter((e) => e.isUnion).length} union`} />
        <StatTile label="Credentials expiring" value={expiring.length + expired.length}
          tone={expired.length ? 'danger' : expiring.length ? 'warn' : 'success'} icon={<BadgeCheck className="size-4" />}
          hint={`${expired.length} expired, ${expiring.length} within 30 days`} />
        <StatTile label="Hours this week" value={qty(weekHours, 1)} icon={<Clock className="size-4" />}
          hint={`${qty(otHours, 1)} overtime (${percent(otHours / Math.max(weekHours, 1), 0)})`} />
        <StatTile label="Awaiting approval" value={pending.length} tone={pending.length ? 'warn' : 'success'}
          hint="timecards not yet approved for payroll" />
      </div>

      <Tabs defaultValue="time">
        <TabsList>
          <TabsTrigger value="time">Time &amp; attendance ({pending.length} pending)</TabsTrigger>
          <TabsTrigger value="credentials">Credentials ({expired.length + expiring.length})</TabsTrigger>
          <TabsTrigger value="roster">Roster ({EMPLOYEES.length})</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ time */}
        <TabsContent value="time" className="space-y-4">
          {pending.length && canApprove ? (
            <div className="flex justify-end">
              <Button onClick={approveAll}><CheckCircle2 className="size-4" /> Approve all {pending.length}</Button>
            </div>
          ) : null}

          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Cost code</TableHead>
                  <TableHead className="text-right">Straight</TableHead>
                  <TableHead className="text-right">Overtime</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium text-charcoal-900">{t.employeeName}</TableCell>
                    <TableCell className="whitespace-nowrap text-charcoal-600">{date(t.workDate)}</TableCell>
                    <TableCell className="font-mono text-xs text-charcoal-600">{t.project}</TableCell>
                    <TableCell className="font-mono text-xs text-charcoal-600">{t.costCode}</TableCell>
                    <TableCell className="tabular text-right">{qty(t.straight, 1)}</TableCell>
                    <TableCell className={cn('tabular text-right', t.overtime > 0 && 'font-medium text-warn-700')}>
                      {t.overtime ? qty(t.overtime, 1) : '—'}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">{qty(t.straight + t.overtime, 1)}</TableCell>
                    <TableCell>
                      {t.exported ? (
                        <Badge variant="default"><Lock className="size-3" /> Exported</Badge>
                      ) : t.approvalState === 'approved' ? (
                        <Badge variant="success">Approved</Badge>
                      ) : (
                        <Badge variant="warn">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.approvalState === 'pending' && canApprove ? (
                        <Button size="sm" variant="outline" onClick={() => approve(t.id)}>Approve</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-charcoal-50">
                  <TableCell colSpan={4}>Total</TableCell>
                  <TableCell className="tabular text-right">{qty(entries.reduce((a, t) => a + t.straight, 0), 1)}</TableCell>
                  <TableCell className="tabular text-right">{qty(otHours, 1)}</TableCell>
                  <TableCell className="tabular text-right">{qty(weekHours, 1)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent></Card>

          {exported.length ? (
            <Alert tone="neutral" icon={<Lock className="size-4" />}
              title={`${plural(exported.length, 'timecard')} locked by payroll export`}>
              A timecard that has gone to payroll is a financial record and stops changing. Correcting one means
              posting an adjusting entry, which keeps the payroll register and the job cost reconcilable.
            </Alert>
          ) : null}
        </TabsContent>

        {/* ----------------------------------------------------- credentials */}
        <TabsContent value="credentials">
          <Card>
            <CardHeader>
              <CardTitle>Credential register</CardTitle>
              <CardDescription>
                Status is recomputed by the database against today's date on every write, so a register maintained
                by hand cannot drift into showing an expired card as valid.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...allCredentials]
                    .sort((a, b) => {
                      const rank = { expired: 0, expiring: 1, valid: 2 } as const;
                      return rank[a.status] - rank[b.status];
                    })
                    .map((c, i) => (
                      <TableRow key={i} className={cn(c.status === 'expired' && 'bg-danger-50/50')}>
                        <TableCell className="font-medium text-charcoal-900">{c.employee}</TableCell>
                        <TableCell className="text-charcoal-600">{c.classification}</TableCell>
                        <TableCell className="text-charcoal-700">{c.name}</TableCell>
                        <TableCell className="whitespace-nowrap text-charcoal-600">
                          {c.expiresOn ? date(c.expiresOn) : <span className="text-charcoal-400">does not expire</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'expired' ? 'danger' : c.status === 'expiring' ? 'warn' : 'success'}>
                            {titleCase(c.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- roster */}
        <TabsContent value="roster">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Hired</TableHead>
                  <TableHead className="text-right">Base rate</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead className="text-right">Credentials</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {EMPLOYEES.map((e) => {
                  const bad = e.credentials.filter((c) => c.status !== 'valid').length;
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{e.name}</p>
                        <p className="font-mono text-xs text-charcoal-400">{e.employeeNumber}</p>
                      </TableCell>
                      <TableCell className="text-charcoal-700">
                        {e.classification}
                        {e.isUnion ? <Badge variant="info" className="ml-1.5 text-[10px]">Union</Badge> : null}
                      </TableCell>
                      <TableCell><Badge variant="outline">{titleCase(e.employmentType)}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-charcoal-600">{date(e.hireDate)}</TableCell>
                      <TableCell className="tabular text-right">{money(e.hourlyRate)}</TableCell>
                      <TableCell className="font-mono text-xs text-charcoal-600">
                        {e.assignedProject ?? <span className="font-sans text-charcoal-400">unassigned</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {bad ? (
                          <Badge variant="warn"><AlertTriangle className="size-3" /> {bad}</Badge>
                        ) : (
                          <Badge variant="success">{e.credentials.length} valid</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
          <Separator className="my-4" />
          <p className="text-xs text-charcoal-500">
            Employee records carry compensation, so reading them requires the <code className="font-mono">hr.read</code> permission
            rather than bare company membership — a foreman should not see everyone's wage.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
