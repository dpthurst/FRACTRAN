#!/usr/bin/env python3
"""Compile little register machines (Minsky machines) into FRACTRAN programs.

A register machine has counters (registers) holding natural numbers and a
program of guarded commands.  FRACTRAN encodes a register value v as the
exponent of the register's prime, and the machine's control state as one
extra "state prime".  Exactly one state prime divides n at any time, so a
fraction whose denominator contains a state prime can only fire while the
machine sits in that state -- this is what turns an ordered fraction list
into a program with jumps.

Instructions (compiled below; p_i = state prime of instruction i, q_r =
register prime of r, p_x = state primes allocated for the instruction):

  INC r -> L      one fraction  p_L * q_r / p_i
  DEC r -> P / Z  two fractions p_P / (p_i * q_r)   -- fires iff r > 0
                                p_Z / p_i           -- fires iff r = 0
  TST r -> P / Z  test without consuming: probe (consume and restore)
                  p_M / (p_i * q_r), q_r * p_P / p_M, p_Z / p_i
  MOVE r -> D -> L  destroy-move:  p_M2/(p_M1*q_r), p_L/p_M1, q_D*p_M1/p_M2
  COPY2 r -> D1,D2 -> L  copy r into two registers, destroying r:
                  p_C2/(p_C1*q_r), p_L/p_C1, q_D1*p_C3/p_C2, q_D2*p_C1/p_C3
  GOTO L          one fraction  p_L / p_i
  HALT            cleanup fraction 1/p_halt appended at the end of the
                  program, so the final n is a pure register product.  The
                  START state prime must be included in the input (there is
                  no way around this: with no state prime present, nothing
                  would fire at all).

The machines below (gcd, fib, fact, sqrt, collatz) are embedded in
examples.js; this script prints them for pasting.  Their behaviour is
NOT trusted at the machine level: tools/oracle.py re-verifies each emitted
program as plain FRACTRAN against direct arithmetic.
"""

PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61,
          67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137,
          139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199,
          211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277,
          281, 283, 293, 307, 311, 313, 317, 331, 337, 347, 349, 353, 359,
          367, 373, 379, 383, 389, 397, 401, 409, 419, 421, 431, 433, 439,
          443, 449, 457, 461, 463, 467, 479, 487, 491, 499]


class Compiler:
    def __init__(self, registers):
        # registers: list of names, in order; they get the first primes
        self.reg = {name: PRIMES[i] for i, name in enumerate(registers)}
        self.next_prime = len(registers)
        self.fracs = []          # (numerator, denominator, comment)
        self.labels = {}         # label -> state prime
        self.alloc = {}          # internal state prime -> hint

    def state(self, label):
        if label not in self.labels:
            self.labels[label] = PRIMES[self.next_prime]
            self.alloc[self.labels[label]] = label
            self.next_prime += 1
        return self.labels[label]

    def frac(self, num_primes, den_primes, note):
        num, den = 1, 1
        for p in num_primes:
            num *= p
        for p in den_primes:
            den *= p
        self.fracs.append((num, den, note))

    # -- instruction emitters; `here` is the current state prime -----------

    def do_inc(self, here, r, nxt):
        self.frac([self.state(nxt), self.reg[r]], [here],
                  f"INC {r} -> {nxt}")

    def do_dec(self, here, r, pos, zer):
        self.frac([self.state(pos)], [here, self.reg[r]],
                  f"DEC {r} -> {pos} / {zer}")
        self.frac([self.state(zer)], [here], f"  ... {zer} if {r} = 0")

    def do_tst(self, here, r, pos, zer):
        m = PRIMES[self.next_prime]
        self.alloc[m] = f"probe({r})"
        self.next_prime += 1
        self.frac([m], [here, self.reg[r]], f"TST {r} -> {pos} / {zer}")
        self.frac([self.reg[r], self.state(pos)], [m], f"  ... restore {r}")
        self.frac([self.state(zer)], [here], f"  ... {zer} if {r} = 0")

    def do_move(self, here, r, d, nxt):
        m1 = PRIMES[self.next_prime]
        self.alloc[m1] = f"move({r}->{d})"
        self.next_prime += 1
        m2 = PRIMES[self.next_prime]
        self.alloc[m2] = f"move({r}->{d})+"
        self.next_prime += 1
        self.frac([m1], [here], f"MOVE {r} -> {d} -> {nxt}: enter loop")
        self.frac([m2], [m1, self.reg[r]], f"  ... take one from {r}")
        self.frac([self.state(nxt)], [m1], f"  ... done, -> {nxt}")
        self.frac([self.reg[d], m1], [m2], f"  ... {d} += 1")

    def do_copy2(self, here, r, d1, d2, nxt):
        c1 = PRIMES[self.next_prime]
        self.alloc[c1] = f"copy({r}->{d1},{d2})"
        self.next_prime += 1
        c2 = PRIMES[self.next_prime]
        self.alloc[c2] = f"copy({r}->{d1},{d2})-"
        self.next_prime += 1
        c3 = PRIMES[self.next_prime]
        self.alloc[c3] = f"copy({r}->{d1},{d2})+1"
        self.next_prime += 1
        self.frac([c1], [here], f"COPY2 {r} -> {d1},{d2} -> {nxt}: enter loop")
        self.frac([c2], [c1, self.reg[r]], f"  ... take one from {r}")
        self.frac([self.state(nxt)], [c1], f"  ... done, -> {nxt}")
        self.frac([self.reg[d1], c3], [c2], f"  ... {d1} += 1")
        self.frac([self.reg[d2], c1], [c3], f"  ... {d2} += 1")

    def do_goto(self, here, nxt):
        self.frac([self.state(nxt)], [here], f"GOTO {nxt}")

    # -- the machine language ----------------------------------------------

    def compile(self, start, program, cleanup_states=()):
        """program: list of (label, op, args...); op in
        inc/dec/tst/move/copy2/goto/halt."""
        self.state(start)
        for item in program:
            label, op, args = item[0], item[1], item[2:]
            here = self.state(label)
            if op == "inc":
                self.do_inc(here, *args)
            elif op == "dec":
                self.do_dec(here, *args)
            elif op == "tst":
                self.do_tst(here, *args)
            elif op == "move":
                self.do_move(here, *args)
            elif op == "copy2":
                self.do_copy2(here, *args)
            elif op == "goto":
                self.do_goto(here, *args)
            elif op == "halt":
                pass
            else:
                raise ValueError(op)
        # cleanup: drop the state primes so the final n is register-only
        for st in cleanup_states:
            p = self.labels[st] if isinstance(st, str) else st
            self.emit_cleanup(p)

    def emit_cleanup(self, p):
        self.fracs.append((1, p, f"HALT cleanup: drop state prime {p}"
                                 f" ({self.alloc.get(p, '?')})"))

    def legend(self, names):
        """names: {register: role}; returns {prime-string: description}."""
        out = {}
        for r, p in self.reg.items():
            out[str(p)] = names.get(r, r)
        for p, hint in self.alloc.items():
            out[str(p)] = f"state: {hint}"
        return out

    def text(self):
        lines = []
        for num, den, note in self.fracs:
            lines.append(f"{num}/{den}{'  # ' + note if note else ''}")
        return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# The machines.  Each returns (compiler, register roles).

def m_gcd():
    c = Compiler(["a", "b", "out", "s"])
    prog = [
        ("LOOP", "tst", "a", "L1", "AZ"),
        ("L1",   "tst", "b", "ST", "BZ"),
        ("ST",   "dec", "a", "ST2", "AZ"),  # consume the pair (zero-branch
        ("ST2",  "dec", "b", "ST3", "BZ"),  #  unreachable: both tested > 0)
        ("ST3",  "inc", "s", "LOOP"),
        ("AZ",   "tst", "b", "AR", "EQ"),   # a = 0; b = 0 -> equal
        ("AR",   "move", "s", "a", "LOOP"), # a was min: restore it
        ("BZ",   "move", "s", "b", "LOOP"), # b was min: restore it
        ("EQ",   "move", "s", "out", "HALT"),
        ("HALT", "halt",),
    ]
    c.compile("LOOP", prog, cleanup_states=["HALT"])
    roles = {"a": "input a", "b": "input b", "out": "gcd(a,b) at halt",
             "s": "min(a,b) so far"}
    return c, roles


def m_fib():
    c = Compiler(["k", "a", "b", "t", "c", "out"])
    prog = [
        ("INIT", "tst", "b", "MAIN", "SB"),   # b = 0 -> set it to 1
        ("SB",   "inc", "b", "MAIN"),
        ("MAIN", "dec", "k", "IT", "FIN"),
        ("IT",   "move", "a", "t", "IB"),     # t = a
        ("IB",   "copy2", "b", "a", "c", "IT2"),  # a = b, c = b
        ("IT2",  "move", "t", "b", "IC"),     # b = a_old
        ("IC",   "move", "c", "b", "MAIN"),   # b = a_old + b_old
        ("FIN",  "move", "a", "out", "HALT"),
        ("HALT", "halt",),
    ]
    c.compile("INIT", prog, cleanup_states=["HALT"])
    roles = {"k": "input k", "a": "F_i (output at halt)", "b": "F_(i+1)",
             "t": "scratch", "c": "scratch", "out": "F_k at halt"}
    return c, roles


def m_fact():
    c = Compiler(["k", "p", "q", "k2", "k3", "out"])
    prog = [
        ("INIT", "tst", "p", "MAIN", "IP"),    # p = 0 -> set it to 1
        ("IP",   "inc", "p", "MAIN"),
        ("MAIN", "tst", "k", "MOUT", "FIN"),
        # consuming multiply: q = p*k, p burns down to 0
        ("MOUT", "tst", "p", "M1", "MEND"),
        ("M1",   "dec", "p", "M2", "MEND"),    # one unit of p consumed
        ("M2",   "copy2", "k", "k2", "k3", "M3"),  # k2 = k3 = k, k = 0
        ("M3",   "tst", "k2", "M4", "M6"),
        ("M4",   "dec", "k2", "M5", "M6"),     # (unreachable zero branch)
        ("M5",   "inc", "q", "M3"),            # q += 1, retest k2
        ("M6",   "move", "k3", "k", "MOUT"),   # restore k
        ("MEND", "move", "q", "p", "MDEC"),    # p = p*k, q = 0
        ("MDEC", "dec", "k", "MAIN", "FIN"),   # k -= 1
        ("FIN",  "move", "p", "out", "HALT"),
        ("HALT", "halt",),
    ]
    c.compile("INIT", prog, cleanup_states=["HALT"])
    roles = {"k": "input k", "p": "running product (= k! at halt)",
             "q": "accumulator", "k2": "copy of k", "k3": "copy of k",
             "out": "k! at halt"}
    return c, roles


def m_sqrt():
    c = Compiler(["n", "s", "o", "r", "w", "out"])
    prog = [
        ("INIT",  "move", "n", "r", "INIT2"),  # r = n (working remainder)
        ("INIT2", "tst", "o", "MAIN", "SO"),   # o = 0 -> set it to 1
        ("SO",    "inc", "o", "MAIN"),
        ("MAIN",  "tst", "r", "C1", "RLOW"),
        ("C1",    "tst", "o", "C2", "ITER"),   # o drained: iteration done
        ("C2",    "dec", "r", "C3", "RLOW"),   # (unreachable zero branch)
        ("C3",    "dec", "o", "C4", "ITER"),   # (unreachable zero branch)
        ("C4",    "inc", "w", "MAIN"),         # park the odd's unit in w
        ("RLOW",  "tst", "o", "DONE", "ITER"), # r=0: o>0 -> r<o done; o=0 -> equal
        ("ITER",  "move", "w", "o", "ITER2"),  # o = o_old, w = 0
        ("ITER2", "inc", "s", "ITER3"),
        ("ITER3", "inc", "o", "ITER4"),
        ("ITER4", "inc", "o", "MAIN"),         # o = o_old + 2
        ("DONE",  "move", "w", "o", "DONE2"),  # restore o (leftover)
        ("DONE2", "move", "s", "out", "HALT"),
        ("HALT",  "halt",),
    ]
    c.compile("INIT", prog, cleanup_states=["HALT"])
    roles = {"n": "input n (drained into r)", "s": "root so far (0 at halt)",
             "o": "last odd tried (left over)", "r": "remainder (0 at halt)",
             "w": "scratch", "out": "floor(sqrt n) at halt"}
    return c, roles


def m_collatz():
    c = Compiler(["n", "s", "h", "t", "u", "w", "out"])
    prog = [
        ("MAIN", "tst", "n", "CK1", "FIN"),    # n = 0: unsupported, halt
        ("CK1",  "dec", "n", "CK1b", "FIN"),   # probe: consume one unit
        ("CK1b", "tst", "n", "CK2", "WAS1"),   # n = 0 now -> n was 1
        ("CK2",  "inc", "n", "PAR"),           # undo the probe
        ("WAS1", "inc", "n", "FIN"),           # restore n = 1
        ("PAR",  "dec", "n", "P1", "EVN"),     # parity: drain n by twos
        ("P1",   "dec", "n", "P2", "ODD"),
        ("P2",   "inc", "h", "PAR"),
        ("EVN",  "move", "h", "n", "ES"),      # n = n/2
        ("ES",   "inc", "s", "MAIN"),
        ("ODD",  "copy2", "h", "n", "w", "O2"),  # n = 2h+1 again
        ("O2",   "move", "w", "n", "O3"),
        ("O3",   "inc", "n", "O4"),
        ("O4",   "move", "n", "t", "O5"),      # t = n
        ("O5",   "copy2", "t", "n", "u", "O6"),  # n = t, u = t
        ("O6",   "copy2", "u", "n", "w", "O7"),  # n = 2t, w = t
        ("O7",   "move", "w", "n", "O8"),      # n = 3t
        ("O8",   "inc", "n", "OS"),            # n = 3n+1
        ("OS",   "inc", "s", "MAIN"),
        ("FIN",  "move", "s", "out", "HALT"),
        ("HALT", "halt",),
    ]
    c.compile("MAIN", prog, cleanup_states=["HALT"])
    roles = {"n": "input n (1 at halt)", "s": "steps taken",
             "h": "halves", "t": "scratch", "u": "scratch", "w": "scratch",
             "out": "number of Collatz steps at halt"}
    return c, roles


MACHINES = {"gcd": m_gcd, "fib": m_fib, "fact": m_fact,
            "sqrt": m_sqrt, "collatz": m_collatz}

if __name__ == "__main__":
    import sys
    which = sys.argv[1:] or list(MACHINES)
    for name in which:
        c, roles = MACHINES[name]()
        print(f"===== {name} =====")
        print(c.text())
        print(f"legend: {c.legend(roles)}")
        print()
