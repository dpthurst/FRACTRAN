/* fractran_sim.c — a fast factor-vector FRACTRAN simulator.
 *
 * The state is the prime factorization of n, held as an array of exponents
 * indexed by a dense table of the primes that occur in the program or the
 * seed.  A step scans the fractions in order and applies the first whose
 * denominator exponents are all covered; if none applies, the program
 * halts.  This is the same algorithm as core.js's "registers" engine and
 * tools/oracle.py's vector mode — written in C for constant-factor speed.
 *
 * Usage:
 *   fractran_sim --program FILE --seed "p^e[,p^e...]" --steps N [--dump-states]
 *                [--progress M]
 *
 *   --program      fraction file: "a/b" or "a" tokens, '#'/'//' comments
 *                  (the same format the web app edits).
 *   --seed         prime powers of the initial n, comma/space separated.
 *   --steps        step cap.
 *   --dump-states  print "n <step> p1^e1 p2^e2 ..." for every state, so a
 *                  trajectory can be diffed against an independent
 *                  implementation (this is how the C simulator is checked
 *                  against tools/oracle.py and OEIS A399511).
 *   --progress M   print "progress <step>" every M steps.
 *
 * Output: on halting, prints "halt <step>"; if the state ever becomes a
 * pure power of a single prime, prints "power <step> <prime> <exponent>"
 * (the PIGAME/PRIMEGAME event).  Always finishes with "done <step>".
 *
 * Exponents are 64-bit; the simulator is exact as long as no exponent
 * overflows (PIGAME's are ~2*10^5 after 10^6 steps).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>

#define MAX_PRIMES 512
#define MAX_FRAC_DEN 16
#define MAX_FRAC_NUM 16
#define MAX_FRACS 4096

typedef struct {
    int idx;          /* dense prime index */
    long long exp;    /* exponent */
} Term;

typedef struct {
    Term den[MAX_FRAC_DEN]; int nden;
    Term num[MAX_FRAC_NUM]; int nnum;
} Frac;

static Frac fracs[MAX_FRACS];
static int nfracs = 0;

static long long primes[MAX_PRIMES];   /* dense table */
static int nprimes = 0;
static long long exponents[MAX_PRIMES];

static int prime_index(long long p) {
    for (int i = 0; i < nprimes; i++)
        if (primes[i] == p) return i;
    if (nprimes >= MAX_PRIMES) { fprintf(stderr, "too many primes\n"); exit(2); }
    primes[nprimes] = p;
    return nprimes++;
}

static int is_prime(long long p) {
    if (p < 2) return 0;
    if (p < 4) return 1;
    if (p % 2 == 0) return 0;
    for (long long d = 3; d * d <= p; d += 2)
        if (p % d == 0) return 0;
    return 1;
}

/* insert (p, +e) into a term list, merging duplicates; returns 0 on overflow */
static int term_add(Term *list, int *n, int cap, int idx, long long e) {
    for (int i = 0; i < *n; i++)
        if (list[i].idx == idx) { list[i].exp += e; return 1; }
    if (*n >= cap) return 0;
    list[*n].idx = idx; list[*n].exp = e; (*n)++;
    return 1;
}

/* parse "a/b" or "a", reduce to lowest terms as a net exponent vector, and
 * store the positive part as the numerator list and the negated part as the
 * denominator list */
static void parse_fraction(const char *tok, const char *srcname) {
    long long a = 0, b = 1;
    const char *slash = strchr(tok, '/');
    char buf[256];
    if (slash) {
        if ((size_t)(slash - tok) >= sizeof buf) { fprintf(stderr, "fraction too long\n"); exit(2); }
        memcpy(buf, tok, slash - tok); buf[slash - tok] = 0;
        a = atoll(buf);
        b = atoll(slash + 1);
    } else {
        a = atoll(tok);
    }
    if (a <= 0 || b <= 0) { fprintf(stderr, "%s: bad fraction %s\n", srcname, tok); exit(2); }

    long long net[MAX_PRIMES] = {0};   /* by dense index, filled lazily */
    int seen[MAX_PRIMES] = {0};

    /* factor a and b by trial division, accumulating net = a - b */
    long long xs[2] = { a, b };
    for (int side = 0; side < 2; side++) {
        long long x = xs[side], d = 2;
        int sign = side == 0 ? 1 : -1;
        while (x > 1) {
            if (d * d > x) { d = x; }
            if (x % d == 0) {
                int idx = prime_index(d);
                if (!seen[idx]) { net[idx] = 0; seen[idx] = 1; }
                net[idx] += sign;
                x /= d;
            } else {
                d += (d == 2) ? 1 : 2;
            }
        }
    }
    Frac *f = &fracs[nfracs];
    f->nden = 0; f->nnum = 0;
    for (int i = 0; i < nprimes; i++) {
        if (!seen[i]) continue;
        if (net[i] > 0) {
            if (!term_add(f->num, &f->nnum, MAX_FRAC_NUM, i, net[i]))
            { fprintf(stderr, "too many numerator terms\n"); exit(2); }
        } else if (net[i] < 0) {
            if (!term_add(f->den, &f->nden, MAX_FRAC_DEN, i, -net[i]))
            { fprintf(stderr, "too many denominator terms\n"); exit(2); }
        }
    }
    nfracs++;
}

static void parse_program_file(const char *path) {
    FILE *fh = fopen(path, "r");
    if (!fh) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    char line[4096];
    while (fgets(line, sizeof line, fh)) {
        char *hash = strchr(line, '#');
        if (hash) *hash = 0;
        char *slash2 = strstr(line, "//");
        if (slash2) *slash2 = 0;
        for (char *tok = strtok(line, " \t\r\n,"); tok; tok = strtok(NULL, " \t\r\n,")) {
            if (nfracs >= MAX_FRACS) { fprintf(stderr, "too many fractions\n"); exit(2); }
            parse_fraction(tok, path);
        }
    }
    fclose(fh);
}

static void parse_seed(const char *s) {
    char buf[512];
    if (strlen(s) >= sizeof buf) { fprintf(stderr, "seed too long\n"); exit(2); }
    strcpy(buf, s);
    for (char *tok = strtok(buf, ", \t"); tok; tok = strtok(NULL, ", \t")) {
        long long p, e = 1;
        char *caret = strchr(tok, '^');
        if (caret) { *caret = 0; e = atoll(caret + 1); }
        p = atoll(tok);
        if (p == 1) continue;   /* the empty product: no prime factors */
        if (!is_prime(p) || e < 0) { fprintf(stderr, "bad seed prime %s\n", tok); exit(2); }
        exponents[prime_index(p)] += e;
    }
}

/* the state is a pure power of a single prime? */
static int pure_power(int *idx_out, long long *exp_out) {
    int found = -1;
    long long e = 0;
    for (int i = 0; i < nprimes; i++) {
        if (exponents[i] > 0) {
            if (found >= 0) return 0;
            found = i; e = exponents[i];
        }
    }
    if (found < 0) return 0;
    *idx_out = found; *exp_out = e;
    return 1;
}

int main(int argc, char **argv) {
    const char *progfile = NULL, *seed = NULL;
    unsigned long long steps = 0, progress = 0, stateEvery = 0;
    int dump = 0;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--program") && i + 1 < argc) progfile = argv[++i];
        else if (!strcmp(argv[i], "--seed") && i + 1 < argc) seed = argv[++i];
        else if (!strcmp(argv[i], "--steps") && i + 1 < argc) steps = strtoull(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--progress") && i + 1 < argc) progress = strtoull(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--state-every") && i + 1 < argc) stateEvery = strtoull(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--dump-states")) dump = 1;
        else { fprintf(stderr, "unknown arg %s\n", argv[i]); return 2; }
    }
    if (!progfile || !seed) { fprintf(stderr, "need --program and --seed\n"); return 2; }

    parse_seed(seed);
    parse_program_file(progfile);   /* after seed: fractions may add primes */

    /* the dump must list primes in a stable order: by prime value */
    int order[MAX_PRIMES];
    for (int i = 0; i < nprimes; i++) order[i] = i;
    for (int i = 0; i < nprimes; i++)
        for (int j = i + 1; j < nprimes; j++)
            if (primes[order[j]] < primes[order[i]]) { int t = order[i]; order[i] = order[j]; order[j] = t; }

    unsigned long long step = 0;
    int halted = 0;
    while (step < steps) {
        int fired = -1;
        for (int i = 0; i < nfracs; i++) {
            Frac *f = &fracs[i];
            int ok = 1;
            for (int t = 0; t < f->nden; t++)
                if (exponents[f->den[t].idx] < f->den[t].exp) { ok = 0; break; }
            if (ok) { fired = i; break; }
        }
        if (fired < 0) { halted = 1; break; }
        Frac *f = &fracs[fired];
        for (int t = 0; t < f->nden; t++) exponents[f->den[t].idx] -= f->den[t].exp;
        for (int t = 0; t < f->nnum; t++) exponents[f->num[t].idx] += f->num[t].exp;
        step++;

        if (dump) {
            printf("n %llu", step);
            for (int i = 0; i < nprimes; i++) {
                int idx = order[i];
                if (exponents[idx] > 0)
                    printf(" %lld^%lld", primes[idx], exponents[idx]);
            }
            printf("\n");
        }
        if (stateEvery && step % stateEvery == 0) {
            printf("state %llu", step);
            for (int i = 0; i < nprimes; i++) {
                int idx = order[i];
                if (exponents[idx] > 0)
                    printf(" %lld^%lld", primes[idx], exponents[idx]);
            }
            printf("\n");
        }
        int pidx; long long pexp;
        if (pure_power(&pidx, &pexp))
            printf("power %llu %lld %lld\n", step, primes[pidx], pexp);
        if (progress && step % progress == 0)
            printf("progress %llu\n", step);
    }
    printf("%s %llu\n", halted ? "halt" : "cap", step);
    printf("done %llu\n", step);
    return 0;
}