# Demo scenarios: three customers, three stories

Same acts as [demo-script.md](demo-script.md), different data. Run **A** as the rehearsal; keep **B** and **C** for the
session. Each uses its own customer and its own new-customer email, so nothing needs resetting between runs.
Numbers are live from the tenant with the demo date 27 Nov 2026.

**Once, before the rehearsal:** send yourself the three emails at the end (from another mailbox if you can), so the agent
can find them in act 6.

**Same in every scenario:**
- Act 0, Microsoft 365 Copilot, Collections agent: *"Analyze this customer's payment behavior and tell me what to chase today."* → it asks which customer.
- Act 1: **Customers** → *Customers with balance* → the scenario's customer. The pane opens on Collections.
- Act 2: **Analyze payment behavior** → widget → **Open … critical invoices**.
- Act 3: **Build aging dashboard** → **Confirm** → in the app click **90+** → **Ask Copilot**. The dashboard covers all
  customers: €124,753.11, then €76,253.12 without 90+, as long as no invoices change.
- Act 4: **Research online** → **Insert into record** → **Insert research**.

---

## A · Northwind Traders (Porto): the chronic late payer. *Rehearsal*

**Story:** Northwind always pays, but always late. Nothing is getting worse, it's just a habit, and the oldest invoice is
close to 90 days.

| | Live value |
|---|---|
| Customer | Northwind Traders, **DEMO-C-1002**, Porto, credit limit €40,000 |
| Overdue | **€22,946.96** on 3 invoices |
| Behaviour | **45.8 days late** on average, trend **stable**, risk **53** |
| Chase today | **103317**, €8,030.38, 86 days, *Call today*; 103318 (49 days) and 103319 (15 days), *Send reminder* |

**Act 5 prompt:**
> Northwind always pays about 46 days late: lower the credit limit to 30,000 and block new invoices.

Expect €40,000 → **€30,000**, Blocked → **Invoice**. Then **Apply to the form** → **Save**.

**Act 6 prompt:**
> Set up Ribeira Logistics as a new customer from João Pinto's email.

Expect: Ribeira Logistics, Lda, Porto, next free number (DEMO-C-1027 if it's the first after Bairro Alto Foods).

---

## B · Fabrikam, Inc. (Lisbon): the account getting worse. *Session*

**Story:** the hero from the demo guide. Over its credit limit, paying later every month, one invoice 100 days late.

| | Live value |
|---|---|
| Customer | Fabrikam, Inc., **DEMO-C-1001**, Lisbon, credit limit €60,000 |
| Overdue | **€73,588.52** on 4 invoices (123 % of the limit) |
| Behaviour | **39.7 days late** on average, trend **worsening** (+3.8 days/month), risk **85** |
| Chase today | **103304**, €48,499.99, 100 days (90+), *Call today*; 103306 (64 days) and 103307 (35 days), *Call today*; 103308 (5 days), *Send reminder* |

**Act 5 prompt:**
> Fabrikam is high risk: reduce the credit limit to 40,000 and block shipments.

Expect €60,000 → **€40,000**, Blocked → **Ship**.

**Act 6 prompt:**
> Set up Alfama Coffee Roasters as a new customer from Marta Lopes's email.

---

## C · Adatum Corporation (Málaga): moderate risk, a lighter touch. *Session*

**Story:** a Spanish customer, a bit late, stable. The agent should suggest reminders, not calls, and the decision is a
small adjustment, not a block. The research is about Spain, not Portugal.

| | Live value |
|---|---|
| Customer | Adatum Corporation, **DEMO-C-1021**, Málaga, credit limit €28,000 |
| Overdue | **€9,148.11** on 2 invoices |
| Behaviour | **16.7 days late** on average, trend **stable**, risk **32** |
| Chase today | **103546**, €5,178.17, 57 days, *Send reminder*; 103548, €3,969.94, 5 days, *Monitor* |

CRONUS ES has its own "Adatum Corporation". Pick the one in *Customers with balance*, which only lists `DEMO-C-*`
customers.

**Act 5 prompt:**
> Adatum is only slightly late: lower the credit limit to 20,000 but don't block them.

Expect €28,000 → **€20,000**, Blocked unchanged.

**Act 6 prompt:**
> Set up Costa del Sol Distribuciones as a new customer from Lucía Martín's email.

---

## The three emails to send yourself

**A · Subject: New account – Ribeira Logistics, Lda**
> Hello, we'd like to open an account with Contoso. Our details:
> Ribeira Logistics, Lda · Rua de São João 45, 4050-552 Porto, Portugal · NIF PT515234567
> Phone +351 222 333 444 · joao.pinto@ribeiralogistics.example · www.ribeiralogistics.example
> Best regards, João Pinto, Accounts

**B · Subject: New account – Alfama Coffee Roasters, Lda**
> Good morning, we'd like to start buying from Contoso. Company details:
> Alfama Coffee Roasters, Lda · Rua dos Remédios 88, 1100-445 Lisboa, Portugal · NIF PT516345678
> Phone +351 218 765 432 · marta.lopes@alfamacoffee.example · www.alfamacoffee.example
> Thanks, Marta Lopes, Finance

**C · Subject: Alta de cliente – Costa del Sol Distribuciones, S.L.**
> Hola, nos gustaría abrir una cuenta con Contoso. Nuestros datos:
> Costa del Sol Distribuciones, S.L. · Calle Larios 21, 29005 Málaga, España · CIF ESB93123456
> Teléfono +34 952 123 456 · lucia.martin@costadelsol.example · www.costadelsol.example
> Un saludo, Lucía Martín, Administración

If the agent can't find an email on stage, paste its text into the pane instead: the result is the same.
