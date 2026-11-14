/// Read-only API over Customer Ledger Entries. The standard API v2.0 has no
/// endpoint with "Closed at Date", which payment-behaviour analysis needs.
/// Dataverse virtual table: dyn365bc_customerledgerentry_ppn_collections_v1_0 (see bc/README.md).
page 50100 "PPN Cust. Ledger Entry API"
{
    PageType = API;
    APIPublisher = 'ppn';
    APIGroup = 'collections';
    APIVersion = 'v1.0';
    EntityName = 'customerLedgerEntry';
    EntitySetName = 'customerLedgerEntries';
    EntityCaption = 'Customer Ledger Entry';
    EntitySetCaption = 'Customer Ledger Entries';
    SourceTable = "Cust. Ledger Entry";
    SourceTableView = where("Document Type" = const(Invoice));
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    DataAccessIntent = ReadOnly;

    layout
    {
        area(Content)
        {
            repeater(Entries)
            {
                field(id; Rec.SystemId) { Caption = 'Id'; }
                field(entryNumber; Rec."Entry No.") { Caption = 'Entry No.'; }
                field(customerNumber; Rec."Customer No.") { Caption = 'Customer No.'; }
                field(documentNumber; Rec."Document No.") { Caption = 'Document No.'; }
                field(postingDate; Rec."Posting Date") { Caption = 'Posting Date'; }
                field(dueDate; Rec."Due Date") { Caption = 'Due Date'; }
                field(closedAtDate; Rec."Closed at Date") { Caption = 'Closed at Date'; }
                field(open; Rec.Open) { Caption = 'Open'; }
                field(amount; Rec.Amount) { Caption = 'Amount'; }
                field(remainingAmount; Rec."Remaining Amount") { Caption = 'Remaining Amount'; }
                field(currencyCode; Rec."Currency Code") { Caption = 'Currency Code'; }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Caption = 'Last Modified Date Time'; }
            }
        }
    }

    trigger OnAfterGetRecord()
    begin
        Rec.CalcFields(Amount, "Remaining Amount");
    end;
}
