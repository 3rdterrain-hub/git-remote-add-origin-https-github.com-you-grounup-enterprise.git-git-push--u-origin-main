/**
 * The Deno surface these functions actually use.
 *
 * Edge Function code had never been typechecked: no tsconfig covered
 * `supabase/functions`, so a renamed field or a wrong argument reached the
 * deploy rather than the build. That mattered little while the functions were
 * thin handlers; it matters a great deal now that one of them maps database
 * rows into the estimating engine, where a mistyped field silently prices with
 * a default instead of the value that was meant.
 *
 * Declared by hand rather than pulled from Deno's full type package because
 * exactly two globals are used, and a hand-written pair that the compiler
 * checks against real call sites is worth more than a large dependency.
 */
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
