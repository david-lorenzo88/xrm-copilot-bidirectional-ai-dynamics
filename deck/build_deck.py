"""Build "Building the Bridge" from the AIERP Summit 2026 template.

    python deck/build_deck.py            # writes deck/Building-the-Bridge.pptx

Every slide is a copy of a template slide (see TEMPLATE_* constants) with its text replaced
and, where needed, native shapes added (code panels, diagrams, tables). Screenshots are read
from deck/assets/screenshots/<name>.png when present; otherwise a labelled placeholder is drawn.
"""
from __future__ import annotations

import os
import sys

from pptx import Presentation

sys.path.insert(0, os.path.dirname(__file__))
from pptx_kit import (  # noqa: E402
    BODY_FONT, BODY_FONT_BOLD, CODE_FONT, DARK_RED, GREY, ICE, INK, MID_GREY, RED, WHITE, YELLOW,
    arrow, box, fix_duplicate_shape_ids, code_panel, drop_revision_parts, drop_slides, duplicate, move,
    notes, picture, remove, remove_empty_placeholders, replace_picture, set_sections, set_text, shape, text,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEMPLATE = os.path.join(ROOT, "AIERP_Summit_2026_Template.pptx")
OUTPUT = os.path.join(HERE, "Building-the-Bridge.pptx")
ASSETS = os.path.join(HERE, "assets")
SHOTS = os.path.join(ASSETS, "screenshots")
REPO_URL = "github.com/david-lorenzo88/xrm-copilot-bidirectional-ai-dynamics"

# Template slide numbers (1-based, as in the template file)
T_SPEAKER, T_THANKS, T_SPLASH = 2, 3, 4
T_THREE_CARDS_A, T_THREE_CARDS_BC, T_WHITE_TITLE = 5, 6, 7
T_SECTION_A, T_SECTION_B = 8, 9
T_RED_THREE_ROWS_A, T_THREE_CARDS_C, T_TITLE_ICON_COLS_A = 10, 11, 12
T_FIVE_ROWS, T_STATEMENT, T_RED_THREE_ROWS_B = 13, 14, 15
T_FOUR_COLS, T_HUB, T_THREE_YELLOW_COLS, T_TITLE_ICON_COLS_B = 16, 17, 18, 19

VERIFIED_ON = "Verified against Microsoft Learn, November 2026"


def new(prs, template_no: int):
    return duplicate(prs, prs.slides[template_no - 1])


def two_part(head: str, body: str, head_size=None, body_size=None):
    """A bold heading paragraph followed by a regular body paragraph."""
    h = {"runs": [{"t": head, "b": True}], "space_after": 4}
    b = {"runs": [{"t": body, "b": False}]}
    if head_size:
        h["size"] = head_size
    if body_size:
        b["size"] = body_size
    return [h, b]


def white_title(prs, title: str, size=32):
    s = new(prs, T_WHITE_TITLE)
    t = shape(s, 17)
    move(t, w=10.0)
    set_text(t, {"runs": [title], "size": size})
    remove_empty_placeholders(s)
    return s


def screenshot(slide, name, x, y, w, h, caption):
    path = os.path.join(SHOTS, f"{name}.png")
    if os.path.exists(path):
        from PIL import Image
        iw, ih = Image.open(path).size
        scale = min(w / iw, h / ih)
        pw, ph = iw * scale, ih * scale
        box(slide, x + (w - pw) / 2 - 0.04, y + (h - ph) / 2 - 0.04, pw + 0.08, ph + 0.08,
            fill=WHITE, line="D9D9D9", radius=0.02, name=f"Frame {name}")
        picture(slide, path, x + (w - pw) / 2, y + (h - ph) / 2, pw, ph)
    else:
        box(slide, x, y, w, h, fill=GREY, line="BFBFBF", dash=True, radius=0.03, name=f"Placeholder {name}")
        text(slide, x + 0.3, y + h / 2 - 0.45, w - 0.6, 0.9,
             [{"t": "Screenshot", "b": True, "size": 16, "color": MID_GREY},
              {"t": caption, "size": 13, "color": MID_GREY}], align="c", anchor="m")


def under_the_hood(slide, x, y, w, h, steps):
    box(slide, x, y, w, h, fill=GREY, radius=0.05, name="Under the hood")
    text(slide, x + 0.3, y + 0.25, w - 0.6, 0.4, [{"t": "Under the hood", "b": True}],
         size=18, color=RED, font=BODY_FONT_BOLD)
    paras = []
    for n, (api, what) in enumerate(steps, 1):
        paras.append({"runs": [{"t": f"{n}  ", "b": True, "color": RED, "font": BODY_FONT_BOLD},
                               {"t": api, "font": CODE_FONT, "size": 14, "color": INK}],
                      "space_after": 2})
        paras.append({"runs": [{"t": what, "size": 14, "color": MID_GREY}], "space_after": 18})
    text(slide, x + 0.3, y + 0.9, w - 0.6, h - 1.05, paras, size=14)


# =========================================================================== slides
def s_walk_in(prs):
    s = new(prs, T_SPLASH)
    notes(s, """Walk-in slide. Leave on screen while people sit down.
Have ready: model-driven app open on the Overdue invoices view, Copilot side panel closed,
mock fallback (npm run demo) running in a second browser profile.""")


def s_title(prs):
    s = new(prs, T_SPEAKER)
    replace_picture(s, 11, os.path.join(ASSETS, "speaker.jpg"))
    set_text(shape(s, 33), "David Lorenzo López")
    job = shape(s, 13)
    move(job, w=4.3, h=0.42)
    set_text(job, [{"runs": ["AI & Automation Architect · Prodware"], "size": 12},
                   {"runs": ["Microsoft MVP · Copilot Studio"], "size": 12}])
    title = shape(s, 34)
    move(title, w=4.45)
    set_text(title, [{"runs": ["Building the Bridge"], "size": 21},
                     {"runs": [{"t": "Bidirectional AI between Dynamics 365 and Copilot with Xrm.Copilot",
                                "b": False, "font": "Roboto"}], "size": 12}])
    set_text(shape(s, 19), "BC · Power Platform")
    notes(s, """Hi, I'm David Lorenzo, AI & Automation Architect at Prodware and Microsoft MVP for Copilot Studio.
Today we build a bridge, live: a model-driven app over Business Central data that shares its state with
Microsoft 365 Copilot, and an agent that reaches back into the app to open records, filter views and
render UI. One scenario end to end, then the architecture, then an honest production map.""")


def s_side_panel_era(prs):
    s = new(prs, T_STATEMENT)
    set_text(shape(s, 2), "Side-panel AI")
    set_text(shape(s, 59), "For years, AI in Dynamics 365 lived next to the app, not in it: "
                           "good at answering questions, blind to the record you had open.")
    notes(s, """Set up the pain. Copilot in a side panel could answer questions, but it didn't know which customer
you were looking at, which view, which filter. Users copy-pasted context into a chatbot, then copy-pasted
answers back. And the agent could never touch the app: no opening records, no navigating, no UI.""")


def s_wall_comes_down(prs):
    s = new(prs, T_RED_THREE_ROWS_B)
    set_text(shape(s, 15), "The wall comes down")
    set_text(shape(s, 16), "Xrm.Copilot turns the side panel into a two-way bridge. "
                           "The app and the agent finally share the same state.")
    for label_id, desc_id, label, desc in [
        (31, 37, "Share", "The app tells Copilot what is on screen"),
        (33, 38, "Ask", "One click sends a grounded prompt"),
        (32, 39, "Act", "The agent opens records and renders UI"),
    ]:
        set_text(shape(s, label_id), label)
        set_text(shape(s, desc_id), desc)
    notes(s, """Three verbs carry the whole talk.
SHARE: the app pushes context (record, view, filter) to Copilot with updateContext.
ASK: the app sends a prompt to a specific agent with sendPromptToM365Copilot.
ACT: the agent sends actions back, and the app handles them with addActionHandler: open records,
navigate views, render components. That is the bridge.""")


def s_agenda(prs):
    s = new(prs, T_TITLE_ICON_COLS_B)
    set_text(shape(s, 37), "One scenario, end to end")
    set_text(shape(s, 39), "A collections workspace for finance teams, on live Business Central data, "
                           "bridged to Microsoft 365 Copilot.")
    for sid, head, body in [
        (40, "Live demo", "Grounding, an agent that operates the app, generative UI"),
        (46, "Architecture", "PCF, declarative agent and MCP Apps server"),
        (47, "Production", "GA vs preview, licensing, the gotchas"),
    ]:
        set_text(shape(s, sid), two_part(head, body))
    notes(s, """45 minutes: about 15 on the live demo, 20 on how it is built, 10 on what is GA, what it costs to
run and what bites you in production. Everything you see is in the GitHub repo at the end.""")


def s_scenario(prs):
    s = new(prs, T_THREE_CARDS_BC)
    set_text(shape(s, 29), "Live ERP data")
    set_text(shape(s, 50), "A model-driven app over Business Central virtual tables: "
                           "every row on screen is live ERP data. No sync, no copies.")
    for sid, head, body in [
        (86, "Customers", "Balance due, terms and credit limit"),
        (87, "Invoices", "Due dates, amounts and status, read live"),
        (88, "Ledger", "Payment history the agent reasons over"),
    ]:
        set_text(shape(s, sid), two_part(head, body))
    notes(s, """The persona is a collections specialist. Their day: which customers do I chase, which invoices first,
and what do I say. The data lives in Business Central; with the Business Central virtual tables in Dataverse,
the model-driven app and the agent read the ERP directly. No integration jobs, no stale copies.""")


def s_section(prs, template_no, title, note):
    s = new(prs, template_no)
    title_id = 10 if template_no == T_SECTION_A else 11
    set_text(shape(s, title_id), title)
    remove_empty_placeholders(s)
    notes(s, note)
    return s


def s_section_architecture(prs):
    s = new(prs, T_SECTION_B)
    set_text(shape(s, 11), "Architecture deep dive")
    for sid, x, head, body in [
        (3, 0.92, "The app surface", "Model-driven app, PCF control, side panes"),
        (4, 6.75, "The Copilot surface", "Declarative agent, MCP Apps widgets"),
    ]:
        ph = shape(s, sid)
        move(ph, x=x, y=2.4, w=5.67, h=1.55)
        ph.fill.solid()
        from pptx.dml.color import RGBColor
        ph.fill.fore_color.rgb = RGBColor.from_string(DARK_RED)
        ph.text_frame.margin_left = ph.text_frame.margin_right = 228600
        ph.text_frame.margin_top = 137160
        set_text(ph, [{"runs": [{"t": head, "b": True}], "size": 28, "color": WHITE, "bullet": False},
                      {"runs": [{"t": body, "b": False}], "size": 18, "color": YELLOW, "bullet": False}])
    notes(s, """Now how it works. One experience that lives on two surfaces: the app the user works in, and the Copilot
pane the agent lives in. Three building blocks connect them.""")


def s_three_beats(prs):
    s = new(prs, T_RED_THREE_ROWS_A)
    set_text(shape(s, 15), "Three moments")
    set_text(shape(s, 16), "A specialist opens Fabrikam, a customer with overdue invoices. "
                           "Watch what Copilot knows, and what it does.")
    for label_id, desc_id, label, desc in [
        (31, 37, "Context", "Grounded in the customer, view and filter"),  # label box widened below
        (33, 38, "Action", "Opens invoices, builds today's list"),
        (32, 39, "UI", "A dashboard appears inside the app"),
    ]:
        move(shape(s, label_id), w=1.12)
        set_text(shape(s, label_id), label)
        set_text(shape(s, desc_id), desc)
    notes(s, """DEMO (about 15 min). Switch to the browser.
1. Open Fabrikam. The Copilot pane opens already grounded: ask "what's going on with this customer?".
2. Click "Analyze payment behavior". Answer in the pane, critical invoices open in side panes,
   the grid switches to a prioritized "chase today" list.
3. Ask: "Build me a dashboard of overdue amounts by customer and aging bucket". It renders in Copilot
   and inside the app. Change a filter in the app and ask a follow-up: the agent sees the change.
Fallback: mock host (npm run demo) or the recap slides that follow.""")


def s_recap(prs, n, title, shot, caption, steps, note):
    s = white_title(prs, f"{n} · {title}")
    screenshot(s, shot, 0.62, 1.9, 7.75, 4.85, caption)
    under_the_hood(s, 8.7, 1.9, 4.03, 4.85, steps)
    notes(s, note)


def s_architecture(prs):
    s = white_title(prs, "Architecture at a glance")
    y0, h0 = 1.85, 3.25

    def column(x, w, head, items, border, highlight=None):
        box(s, x, y0, w, h0, fill=WHITE, line=border, line_w=2.0, radius=0.05, name=f"Column {head}")
        text(s, x + 0.2, y0 + 0.12, w - 0.4, 0.5, [{"t": head, "b": True}], size=14, color=border,
             font=BODY_FONT_BOLD)
        for k, item in enumerate(items):
            fill = YELLOW if highlight == k else GREY
            b = box(s, x + 0.2, y0 + 0.7 + k * 0.82, w - 0.4, 0.66, fill=fill, radius=0.12)
            text(s, 0, 0, 0, 0, [{"runs": item if isinstance(item, list) else [item]}], size=12,
                 align="c", anchor="m", target=b)

    column(0.62, 3.75, "Model-driven app", [
        [{"t": "PCF · CollectionsBridge", "b": True}],
        "Side panes · views · forms",
        [{"t": "<AgingDashboard/>", "font": CODE_FONT}],
    ], RED, highlight=0)
    column(5.6, 3.3, "Microsoft 365 Copilot pane", [
        [{"t": "Declarative agent", "b": True}],
        "MCP App widgets (ui://)",
        [{"t": "<AgingDashboard/>", "font": CODE_FONT}],
    ], DARK_RED, highlight=0)
    column(10.13, 2.6, "MCP Apps server", [
        [{"t": "Tools", "b": True}],
        "ui:// resources",
        "Aging & risk logic",
    ], INK, highlight=0)

    # app <-> copilot
    arrow(s, 4.42, 2.85, 5.55, 2.85, color=RED)
    text(s, 4.4, 2.2, 1.2, 0.6, [{"t": "context", "b": True}, "prompts"], size=10, color=RED, align="c",
         anchor="b")
    arrow(s, 5.55, 3.85, 4.42, 3.85, color=DARK_RED)
    text(s, 4.4, 3.92, 1.2, 0.4, [{"t": "actions", "b": True}], size=10, color=DARK_RED, align="c")
    # copilot <-> server
    arrow(s, 8.95, 2.85, 10.08, 2.85, color=INK)
    text(s, 8.9, 2.2, 1.25, 0.6, [{"t": "tools/call", "b": True}, "(MCP)"], size=10, align="c", anchor="b")
    arrow(s, 10.08, 3.85, 8.95, 3.85, color=INK)
    text(s, 8.9, 3.92, 1.25, 0.4, [{"t": "widgets", "b": True}], size=10, align="c")

    # data layer
    dv = box(s, 0.62, 5.6, 12.11, 1.1, fill=ICE, radius=0.1, name="Dataverse")
    text(s, 0, 0, 0, 0, [{"runs": [{"t": "Dataverse  ", "b": True, "size": 15},
                                    {"t": "BC virtual tables (dyn365bc_*)  ·  dashboard spec = shared state  ·  "
                                           "audit of agent actions  ⇄  ", "size": 12},
                                    {"t": "Business Central", "b": True, "size": 12}]}],
         align="c", anchor="m", target=dv)
    arrow(s, 2.5, 5.12, 2.5, 5.58, color=RED, both=True)
    arrow(s, 11.43, 5.12, 11.43, 5.58, color=INK, both=True)
    text(s, 11.55, 5.15, 1.2, 0.4, [{"t": "OBO", "b": True}], size=10)
    notes(s, """Left: the model-driven app. A PCF control is the app-side end of the bridge: it publishes context,
sends prompts and handles actions. Middle: the Microsoft 365 Copilot pane with our declarative agent.
Its action plugin is an MCP server, and some tools return UI widgets (MCP Apps). Right: the MCP server,
running in Azure, with the tools and the widget HTML. Bottom: Dataverse, where Business Central lives
as virtual tables, and where the shared dashboard spec is stored.
Key point: the same React component renders the dashboard in both surfaces.""")


def s_building_blocks(prs):
    s = new(prs, T_THREE_CARDS_A)
    set_text(shape(s, 29), "Three building blocks")
    set_text(shape(s, 50), "One experience on two surfaces needs three pieces, "
                           "each owning one end of the bridge.")
    for sid, head, body in [
        (86, "PCF control", "Publishes context, sends prompts, handles actions"),
        (87, "Agent", "Declarative agent with an MCP action plugin"),
        (88, "MCP server", "Tools on Dataverse plus ui:// widgets"),
    ]:
        set_text(shape(s, sid), two_part(head, body))
    notes(s, """PCF control: lives on the customer form, owns everything Xrm.Copilot. Context out, prompts out,
actions in.
Declarative agent: instructions, conversation starters and one action: an MCP server.
MCP Apps server: tools that read Business Central through Dataverse, and widgets (ui:// resources)
that Copilot renders as generative UI. The widgets are what emit actions back to the app.""")


def s_xrm_map(prs):
    s = new(prs, T_FIVE_ROWS)
    set_text(shape(s, 2), "The Xrm.Copilot surface")
    ga = {"t": "  GA", "b": True, "color": "1E7B34"}
    pv = {"t": "  Preview", "b": True, "color": RED}
    rows = [
        (310, 315, "Availability", [{"t": "isM365CopilotEnabled() · getCurrentAgent()", "font": CODE_FONT, "size": 12},
                                    {"t": "  license, env, indexing, rollout; cached 30 min"}, ga]),
        (311, 316, "Panel & prompt", [{"t": "openM365CopilotPanel() · sendPromptToM365Copilot()",
                                       "font": CODE_FONT, "size": 12}, ga]),
        (312, 317, "Context", [{"t": "updateContext({ entity, filterXML })", "font": CODE_FONT, "size": 12},
                               {"t": "  GA in reference, preview on maker docs", "b": True, "color": DARK_RED}]),
        (313, 318, "Agent actions", [{"t": "add/removeActionHandler", "font": CODE_FONT, "size": 12},
                                     {"t": " + OpenRecord, NavigateToView"}, ga]),
        (314, 319, "Copilot Studio", [{"t": "executeEvent · executePrompt", "font": CODE_FONT, "size": 12}, pv]),
    ]
    for label_id, desc_id, label, runs in rows:
        set_text(shape(s, label_id), [{"runs": [{"t": label, "b": True}]}])
        set_text(shape(s, desc_id), [{"runs": runs}])
    notes(s, f"""The whole namespace on one slide. {VERIFIED_ON}.
Availability: isM365CopilotEnabled checks the kill switch, license, environment setting, Dataverse indexing,
app override and rollout flag, and caches the result for 30 minutes. Every other method is a no-op when it is false.
Panel and prompt: open the pane, send a prompt to a specific agent with gptId.
Context: updateContext. The reference lists it as GA, the maker docs call it preview: check before you ship.
Actions: register handlers by action ID. Two built-ins: MS.PA.CopilotChat.OpenRecord and NavigateToView.
Copilot Studio: executeEvent and executePrompt run topics and return MCSResponse[]. Preview.""")


APP_TO_AGENT_CODE = """
// Publish what is on screen whenever the form or view changes
const copilot = Xrm.Copilot;
if (await copilot.isM365CopilotEnabled()) {
  await copilot.updateContext({
    entity: "dyn365bc_customer_v2_0",
    recordId, customerName: "Fabrikam",
    view: "Overdue invoices",
    filterXML: overdueFetchXml,
  });
  await copilot.openM365CopilotPanel();
}

// One click: a grounded request to OUR agent
await copilot.sendPromptToM365Copilot(
  "Analyze this customer's payment behavior",
  { gptId: COLLECTIONS_AGENT_ID });
"""

AGENT_TO_APP_PCF = """
// In the app (PCF): handle a custom action
await Xrm.Copilot.addActionHandler(
  "Contoso.Collections.OpenInvoices",
  async ({ invoiceIds }) => {
    for (const id of invoiceIds.slice(0, 3)) {
      const pane = Xrm.App.sidePanes
        .createPane({ canClose: true });
      await pane.navigate({
        pageType: "entityrecord",
        entityName: INVOICE_TABLE,
        entityId: id });
    }
  });
"""

AGENT_TO_APP_WIDGET = """
// In Copilot (MCP App widget): emit it
window.parent.parent.postMessage({
  eventName: "powerapps.copilot.chat.action",
  action: "Contoso.Collections.OpenInvoices",
  actionData: { invoiceIds },
}, "*");
"""


def s_code_app_to_agent(prs):
    s = white_title(prs, "App → agent: share, then ask")
    code_panel(s, 0.62, 1.9, 7.9, 4.85, APP_TO_AGENT_CODE, size=13, label="PCF · CollectionsBridge")
    tips = [
        ("Guard once", "Every method is a no-op when Copilot is disabled"),
        ("Merged for you", "appId, orgId, geo and schema version are added to your context"),
        ("Target an agent", "gptId sends the prompt to your declarative agent, not the default"),
    ]
    for k, (head, body) in enumerate(tips):
        y = 1.9 + k * 1.65
        box(s, 8.8, y, 3.93, 1.45, fill=GREY, radius=0.08)
        text(s, 9.05, y + 0.18, 3.45, 1.15, [
            {"runs": [{"t": head, "b": True, "color": RED, "font": BODY_FONT_BOLD}], "size": 15, "space_after": 4},
            {"runs": [body], "size": 13},
        ], size=13, color=INK)
    notes(s, """Two calls do the grounding. updateContext publishes what is on screen: table, record, view and the
FetchXML of the current filter. The platform merges in appId, orgId, geo and schema version.
Then sendPromptToM365Copilot sends a prompt to a specific agent, by gptId. Guard everything with
isM365CopilotEnabled: if any switch is off, the calls silently do nothing.""")


def s_code_agent_to_app(prs):
    s = white_title(prs, "Agent → app: actions")
    code_panel(s, 0.62, 1.9, 6.35, 4.85, AGENT_TO_APP_PCF, size=12.5, label="In the app")
    code_panel(s, 7.17, 1.9, 5.56, 2.75, AGENT_TO_APP_WIDGET, size=12, label="In Copilot")
    box(s, 7.17, 4.85, 5.56, 1.9, fill=GREY, radius=0.08)
    text(s, 7.42, 5.0, 5.1, 1.65, [
        {"runs": [{"t": "Built-in actions", "b": True, "color": RED}], "space_after": 2},
        {"runs": [{"t": "MS.PA.CopilotChat.OpenRecord", "font": CODE_FONT, "size": 12}]},
        {"runs": [{"t": "MS.PA.CopilotChat.NavigateToView", "font": CODE_FONT, "size": 12}], "space_after": 6},
        {"runs": [{"t": "Or from an Adaptive Card: ", "size": 12},
                  {"t": "{ type: \"PowerApps\", action, actionData }", "font": CODE_FONT, "size": 11}]},
    ], size=13)
    notes(s, """The reverse direction. The app registers a handler per action ID. Here, OpenInvoices opens each critical
invoice in its own side pane. The agent emits the action from the widget it rendered in Copilot, with a
postMessage carrying eventName powerapps.copilot.chat.action. From an Adaptive Card, the same payload goes
in Action.Submit data with type PowerApps. Two actions come built in: OpenRecord and NavigateToView.
Treat every payload as untrusted input: allow-list action IDs and validate the data.""")


def s_contract(prs):
    s = white_title(prs, "The bridge contract")
    rows = [
        ("Action", "Payload", "Emitted by", "What the app does"),
        ("OpenInvoices", "invoiceIds[]", "priority-list widget", "Opens each critical invoice in a side pane"),
        ("ShowWorklist", "fetchXml, title", "priority-list widget", "Switches the grid to today's prioritized list"),
        ("RenderDashboard", "dashboardId | spec", "aging-dashboard widget", "Renders <AgingDashboard> in the app"),
        ("LogFollowUp", "customerNo, note, date", "agent proposal", "Asks to confirm, then writes to Dataverse"),
    ]
    widths = [2.55, 2.55, 2.6, 4.41]
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    tbl = s.shapes.add_table(len(rows), 4, Inches(0.62), Inches(1.95), Inches(sum(widths)), Inches(4.2)).table
    for c, w in enumerate(widths):
        tbl.columns[c].width = Inches(w)
    for r, row in enumerate(rows):
        tbl.rows[r].height = Inches(0.7 if r == 0 else 0.86)
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor.from_string(RED if r == 0 else (GREY if r % 2 else WHITE))
            cell.margin_left = cell.margin_right = Inches(0.15)
            from pptx.enum.text import MSO_ANCHOR
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            p = cell.text_frame.paragraphs[0]
            run = p.add_run()
            run.text = val
            f = run.font
            f.size = Pt(14 if r == 0 else 13)
            f.bold = r == 0 or c == 0
            f.name = CODE_FONT if (r > 0 and c in (0, 1)) else (BODY_FONT_BOLD if r == 0 else BODY_FONT)
            f.color.rgb = RGBColor.from_string(WHITE if r == 0 else (RED if c == 0 else INK))
    text(s, 0.62, 6.35, 12.1, 0.4, [{"runs": [
        {"t": "Namespace ", "color": MID_GREY},
        {"t": "Contoso.Collections.*", "font": CODE_FONT, "color": INK},
        {"t": "  ·  one versioned TypeScript contract shared by the PCF, the MCP server and the widgets",
         "color": MID_GREY}]}], size=12)
    notes(s, """The bridge needs a contract, just like an API. Four custom actions under one namespace, each with a typed
payload, all defined once in a shared TypeScript package used by the PCF, the MCP server and the widgets.
The app only executes actions on its allow-list, after validating the payload.
LogFollowUp is the one that writes: the agent proposes, the user confirms, and it lands in a local Dataverse
table, never directly in the ERP.""")


def s_shared_state(prs):
    s = new(prs, T_HUB)
    set_text(shape(s, 2), "One spec, two surfaces")
    nodes = [
        (28, 32, "Ask", "User asks for overdue by customer × aging"),
        (26, 30, "Spec", "A tool writes the spec to Dataverse"),
        (70, 72, "Widget", "Copilot renders <AgingDashboard>"),
        (74, 76, "Action", "The widget emits RenderDashboard"),
        (75, 77, "PCF", "The app renders the same component"),
        (71, 73, "Context", "Edits flow back via updateContext"),
    ]
    for label_id, desc_id, label, desc in nodes:
        set_text(shape(s, label_id), label)
        set_text(shape(s, desc_id), desc)
    set_text(shape(s, 79), "No live push into widgets yet: sync is event- and pull-driven, last write wins.")
    notes(s, """How do two surfaces stay in sync? Make the state explicit: a small JSON dashboard spec stored in Dataverse.
The agent's tool writes it, the widget renders it in Copilot, the widget emits RenderDashboard, and the PCF
renders the same React component from the same spec inside the app. When the user changes a filter in the
app, the PCF updates the spec and calls updateContext, so the next agent turn sees it.
Honest caveat: Copilot does not support onhostcontextchanged for MCP Apps, so you cannot push live updates
into a widget. Design for event-driven sync with a version number.""")


def s_erp(prs):
    s = new(prs, T_THREE_CARDS_C)
    set_text(shape(s, 29), "Agents on ERP data")
    set_text(shape(s, 50), "Business Central virtual tables put live ERP data in Dataverse: the app, "
                           "the agent and its tools all read one source.")
    for sid, head, body in [
        (86, "Read live", "Customers, invoices and ledger via dyn365bc_*"),
        (87, "Compute", "Aging and risk in code: virtual tables aggregate poorly"),
        (88, "Write local", "Proposals land in Dataverse, never in the ERP"),
    ]:
        set_text(shape(s, sid), two_part(head, body))
    notes(s, """Three rules for putting agents on ERP data.
Read live: enable the Business Central virtual tables you need (customers, sales invoices, ledger entries).
Compute in code: virtual tables have limited aggregate and group-by support, so aging buckets and risk scores
are calculated in the MCP server, which is also easier to test.
Write locally: anything the agent proposes is written to local Dataverse tables after user confirmation.
The ERP stays the system of record, untouched by the agent.""")


def s_ga_preview(prs):
    s = new(prs, T_THREE_YELLOW_COLS)
    set_text(shape(s, 12), "What is GA, what is preview")
    cols = [
        (34, 33, 39, 101, ["Generally", "available"],
         "Prompts, panel, availability and action handlers",
         ["Build the bridge on these", "Guard with isM365CopilotEnabled"],
         "Production bridges today"),
        (35, 37, 42, 102, ["Preview", "(Copilot Studio)"],
         "executeEvent and executePrompt: run topics, get MCSResponse[]",
         ["Pilots and prototypes", "Keep behind a flag"],
         "Copilot Studio-first teams"),
        (36, 38, 43, 103, ["Verify before", "you ship"],
         "updateContext status, MCP Apps feature coverage in Copilot",
         ["Docs disagree today", "Isolate in one adapter"],
         VERIFIED_ON.replace("Verified against Microsoft Learn, ", "Checked: ")),
    ]
    for head_id, body_id, bullets_id, foot_id, head, body, bullets, foot in cols:
        set_text(shape(s, head_id), head)
        set_text(shape(s, body_id), body)
        set_text(shape(s, bullets_id), bullets)
        set_text(shape(s, foot_id), foot)
    notes(s, f"""{VERIFIED_ON}. Re-check the week of the session.
GA: everything you need for the bridge: sending prompts, opening the panel, availability, action handlers,
built-in handlers, getCurrentAgent.
Preview: the Copilot Studio pair, executeEvent and executePrompt. Great for pilots, not for production.
Verify: updateContext is listed GA in the API reference but preview on the maker page, and MCP Apps in Copilot
support only part of the spec (no host-context change, no teardown, only readOnlyHint).""")


def s_licensing(prs):
    s = new(prs, T_TITLE_ICON_COLS_A)
    set_text(shape(s, 37), "Licensing & prerequisites")
    set_text(shape(s, 39), "Every switch must be on: isM365CopilotEnabled checks license, environment, "
                           "Dataverse indexing, app override and rollout.")
    for sid, head, body in [
        (40, "Users", "Microsoft 365 Copilot plus Dynamics 365 or Power Apps"),
        (46, "Environment", "Copilot on for tenant, env and app; Dataverse search on"),
        (47, "ERP & agent", "BC virtual tables set up; agent approved by admin"),
    ]:
        set_text(shape(s, sid), two_part(head, body))
    notes(s, """Users need a Microsoft 365 Copilot license on top of their Dynamics 365 or Power Apps license, and a
Business Central license to use the ERP data. Copilot must be enabled at tenant, environment and app level,
with Dataverse search indexing on, and the default agent set in the app's Copilot settings.
The declarative agent must be published and approved in the Microsoft 365 admin center.
Licensing changes often: confirm the current requirements with your Microsoft contact.""")


def s_checklist(prs):
    s = new(prs, T_FIVE_ROWS)
    set_text(shape(s, 2), "Production checklist")
    rows = [
        (310, 315, "Licensing", "Copilot, Dynamics or Power Apps, and BC licenses; Copilot on at tenant, env and app"),
        (311, 316, "Governance", "Agent approval in M365 admin, DLP for the MCP connector, audit agent actions"),
        (312, 317, "Security", "Entra SSO + OBO, least privilege, action allow-list, validate payloads"),
        (313, 318, "ALM", "Ship solution, PCF, agent and MCP server as one release"),
        (314, 319, "Gotchas", "30-min enablement cache, widget domain, hidden starters"),
    ]
    for label_id, desc_id, label, desc in rows:
        set_text(shape(s, label_id), [{"runs": [{"t": label, "b": True}]}])
        set_text(shape(s, desc_id), desc)
    notes(s, """The checklist I wish I had.
Licensing: covered on the previous slide.
Governance: agent publishing and approval, DLP policies covering the MCP connector, and an audit table of every
action the agent triggered in the app.
Security: Entra SSO with on-behalf-of to Dataverse, so the agent sees only what the user can see; an allow-list
of action IDs; validate every postMessage payload.
ALM: four artifacts (Dataverse solution, PCF, agent package, Azure service) versioned and released together.
Gotchas: isM365CopilotEnabled caches for 30 minutes; widgets run on a hashed widget-renderer domain (CSP/CORS);
starter prompts don't render when a default agent is set.""")


def s_takeaways(prs):
    s = new(prs, T_FOUR_COLS)
    set_text(shape(s, 2), "Key takeaways")
    cols = [
        (43, 47, 51, "Know the map", "GA for the bridge, preview for Copilot Studio events", "Check the docs often"),
        (44, 48, 52, "Build the bridge", "PCF + agent + MCP Apps: context, prompts, actions, state", "One shared contract"),
        (45, 49, 53, "Ground on ERP", "BC virtual tables: live data for app and agent", "Compute in code"),
        (46, 50, 54, "Ship for real", "Licensing, governance and security from day one", "Use the checklist"),
    ]
    for head_id, body_id, foot_id, head, body, foot in cols:
        set_text(shape(s, head_id), head)
        set_text(shape(s, body_id), body)
        set_text(shape(s, foot_id), foot)
    notes(s, """Four things to take home. Know the map: what is GA and what is preview. Build the bridge with three pieces
and one contract. Ground agents on live ERP data with Business Central virtual tables. And treat production
readiness (licensing, governance, security, ALM) as a day-one concern, not a go-live surprise.""")


def s_resources(prs):
    s = new(prs, T_STATEMENT)
    set_text(shape(s, 2), "Get the code")
    set_text(shape(s, 59), [
        {"runs": ["PCF, declarative agent, MCP Apps server, mock host and this deck:"], "size": 18},
        {"runs": [{"t": REPO_URL, "i": False, "b": True}], "size": 13},
        {"runs": [{"t": "davidlorenzo.website · powerplatformninja.com", "i": False}], "size": 14},
    ])
    box(s, 8.45, 1.55, 3.1, 3.1, fill=WHITE, radius=0.06)
    picture(s, os.path.join(ASSETS, "qr-repo.png"), 8.6, 1.7, 2.8, 2.8)
    notes(s, """Everything is on GitHub: the PCF control, the declarative agent, the MCP Apps server with its widgets,
the offline mock host and this deck. Scan the code.""")


def s_thanks(prs):
    s = new(prs, T_THANKS)
    notes(s, "Thank the sponsors and organisers. Questions.")


def build():
    prs = Presentation(TEMPLATE)
    n_template = len(prs.slides)

    s_walk_in(prs)
    s_title(prs)
    s_side_panel_era(prs)
    s_wall_comes_down(prs)
    s_agenda(prs)
    s_scenario(prs)
    s_section(prs, T_SECTION_A, "Live demo", "Switch to the demo. Three moments, one customer: Fabrikam.")
    s_three_beats(prs)
    s_recap(prs, 1, "Grounded from the first message", "beat1-grounded",
            "Customer form with the Copilot pane already grounded", [
                ("isM365CopilotEnabled()", "Guard: license, env, indexing, rollout"),
                ("updateContext({ … })", "Customer, view and FetchXML filter"),
                ("openM365CopilotPanel()", "Pane opens with the default agent"),
            ], """Recap of beat 1. The PCF publishes the customer, the view and the current FetchXML filter as context,
then opens the Copilot pane. The first question needs no explanation: Copilot already knows it is Fabrikam,
the Overdue invoices view, filtered to open items.""")
    s_recap(prs, 2, "The agent operates the app", "beat2-operate",
            "Invoices open in side panes, prioritized worklist in the grid", [
                ("sendPromptToM365Copilot()", "One click, sent to our agent by gptId"),
                ("prioritize_collections", "MCP tool scores invoices on live BC data"),
                ("OpenInvoices · ShowWorklist", "Widget actions open panes, filter the grid"),
            ], """Recap of beat 2. One click sends a prompt to our agent. It calls MCP tools that analyze payment
behavior over the open invoices, answers in the pane and renders a priority-list widget. The widget emits
OpenInvoices and ShowWorklist: the critical invoices open in side panes and the grid switches to exactly
what to chase today.""")
    s_recap(prs, 3, "Generative UI on two surfaces", "beat3-dashboard",
            "The same aging dashboard in Copilot and inside the app", [
                ("build_aging_dashboard", "Tool writes a DashboardSpec to Dataverse"),
                ("RenderDashboard", "Widget hands the spec to the app"),
                ("<AgingDashboard spec />", "Same component on both surfaces"),
            ], """Recap of beat 3. The user asks for a dashboard. A tool creates a spec, the widget renders it in Copilot
and emits RenderDashboard, and the PCF renders the same React component from the same spec inside the app.
Change a filter in the app: the PCF updates the spec and the context, and the agent sees the change.""")
    s_section_architecture(prs)
    s_architecture(prs)
    s_building_blocks(prs)
    s_xrm_map(prs)
    s_code_app_to_agent(prs)
    s_code_agent_to_app(prs)
    s_contract(prs)
    s_shared_state(prs)
    s_erp(prs)
    s_section(prs, T_SECTION_A, "Production reality",
              "What is GA, what it takes to license and run, and the sharp edges.")
    s_ga_preview(prs)
    s_licensing(prs)
    s_checklist(prs)
    s_takeaways(prs)
    s_resources(prs)
    s_thanks(prs)

    drop_slides(prs, n_template)
    set_sections(prs, [("Opening", 6), ("Live demo", 5), ("Architecture", 9), ("Production", 4), ("Closing", 3)])
    drop_revision_parts(prs)
    fix_duplicate_shape_ids(prs)
    prs.save(OUTPUT)
    print(f"Wrote {OUTPUT} ({len(prs.slides)} slides)")


if __name__ == "__main__":
    build()
