export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AlphaReply */
        AlphaReply: {
            /**
             * Kind
             * @constant
             */
            kind: "reply";
            /** Text */
            text: string;
        };
        /** AlphaStop */
        AlphaStop: {
            /**
             * Kind
             * @constant
             */
            kind: "stop";
            /**
             * Outcome
             * @enum {string}
             */
            outcome: "complete" | "waiting_for_user" | "blocked";
            /** Text */
            text: string;
        };
        /** AreaIdentification */
        AreaIdentification: {
            /** Goal */
            goal: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "project" | "workflow";
            /** Title */
            title: string;
        };
        /** AreaPublish */
        AreaPublish: {
            /** Body */
            body: components["schemas"]["DraftDocument"] | components["schemas"]["DraftTable"] | components["schemas"]["DraftView"];
            /**
             * Kind
             * @constant
             */
            kind: "publish_artifact";
            target: components["schemas"]["DecisionTarget"] | null;
            work_area: components["schemas"]["AreaIdentification"];
        };
        /** AreaReply */
        AreaReply: {
            /**
             * Kind
             * @constant
             */
            kind: "reply";
            /** Text */
            text: string;
            work_area: components["schemas"]["AreaIdentification"];
        };
        /** AttachmentRef */
        AttachmentRef: {
            /** Ref */
            ref: string;
            /** Sha256 */
            sha256: string;
        };
        /** CSVCheck */
        CSVCheck: {
            /** Expected Sum */
            expected_sum: string;
            /**
             * Kind
             * @constant
             */
            kind: "csv_totals";
            /** Mismatch Count */
            mismatch_count: number;
        };
        /** CSVDecision */
        CSVDecision: {
            attachment: components["schemas"]["AttachmentRef"] | null;
            /**
             * Kind
             * @constant
             */
            kind: "reconcile_csv";
            /**
             * Rounding
             * @enum {string}
             */
            rounding: "ROUND_HALF_UP" | "ROUND_HALF_EVEN";
            target: components["schemas"]["DecisionTarget"] | null;
        };
        /** DecisionTarget */
        DecisionTarget: {
            /** Artifact Id */
            artifact_id: string;
            /** Body Hash */
            body_hash: string;
            /** Revision Id */
            revision_id: string;
        };
        /** DiscoverCapabilities */
        DiscoverCapabilities: {
            /**
             * Kind
             * @constant
             */
            kind: "discover_capabilities";
        };
        /** DraftAction */
        DraftAction: {
            /** Binding */
            binding: string;
            /**
             * Kind
             * @constant
             */
            kind: "read_binding";
            /** Name */
            name: string;
            payload_schema: components["schemas"]["DraftPayloadSchema"];
        };
        /** DraftBlock */
        DraftBlock: {
            /** Block Id */
            block_id: string;
            /** Checked */
            checked: boolean | null;
            /**
             * Kind
             * @enum {string}
             */
            kind: "heading" | "paragraph" | "checklist" | "protected_note";
            /** Text */
            text: string;
        };
        /** DraftDocument */
        DraftDocument: {
            /** Blocks */
            blocks: components["schemas"]["DraftBlock"][];
            /** Title */
            title: string;
        };
        /** DraftField */
        DraftField: {
            /** Editable */
            editable: boolean;
            /** Enum */
            enum: string[] | null;
            /** Key */
            key: string;
            /** Label */
            label: string;
            /** Scale */
            scale: number | null;
            /**
             * Type
             * @enum {string}
             */
            type: "text" | "integer" | "decimal" | "boolean" | "enum";
            /** Unit */
            unit: string | null;
        };
        /** DraftPayloadSchema */
        DraftPayloadSchema: {
            /**
             * Additionalproperties
             * @constant
             */
            additionalProperties: false;
            properties: components["schemas"]["EmptyPayload"];
            /**
             * Type
             * @constant
             */
            type: "object";
        };
        /** DraftSource */
        DraftSource: {
            /** Css */
            css: string;
            /** Html */
            html: string;
            /** Js */
            js: string;
        };
        /** DraftTable */
        DraftTable: {
            /** Fields */
            fields: components["schemas"]["DraftField"][];
            /**
             * Kind
             * @constant
             */
            kind: "structured_table";
            /** Notes */
            notes: string[];
            /** Rows */
            rows: components["schemas"]["TableRow"][];
            /** Title */
            title: string;
            /**
             * Version
             * @constant
             */
            version: "structured-table/v1";
        };
        /** DraftView */
        DraftView: {
            /** Access Generation */
            access_generation: number;
            /** Actions */
            actions: components["schemas"]["DraftAction"][];
            /** Bindings */
            bindings: components["schemas"]["ViewBinding"][];
            /** Fallback */
            fallback: string;
            /**
             * Kind
             * @constant
             */
            kind: "custom_view";
            source: components["schemas"]["DraftSource"];
            /** Title */
            title: string;
            /**
             * Version
             * @constant
             */
            version: "custom-view/v1";
        };
        /** EmptyPayload */
        EmptyPayload: Record<string, never>;
        /** FormField */
        FormField: {
            /** Label */
            label: string;
            /** Name */
            name: string;
        };
        /** LoadSkill */
        LoadSkill: {
            /**
             * Kind
             * @constant
             */
            kind: "load_skill";
            /** Sha256 */
            sha256: string;
            /** Skill Id */
            skill_id: string;
            /** Version */
            version: string;
        };
        /** PublishDecision */
        PublishDecision: {
            /** Body */
            body: components["schemas"]["DraftDocument"] | components["schemas"]["DraftTable"] | components["schemas"]["DraftView"];
            /**
             * Kind
             * @constant
             */
            kind: "publish_artifact";
            target: components["schemas"]["DecisionTarget"] | null;
        };
        /** ReadContext */
        ReadContext: {
            /**
             * Kind
             * @constant
             */
            kind: "read_context";
            /**
             * Section
             * @enum {string}
             */
            section: "messages" | "target" | "attachments";
        };
        /** ReadSavedWork */
        ReadSavedWork: {
            /**
             * Kind
             * @constant
             */
            kind: "read_saved_work";
            target: components["schemas"]["DecisionTarget"];
        };
        /** RecordResponsibility */
        RecordResponsibility: {
            /** Completion Criteria */
            completion_criteria: string[];
            /** Goal */
            goal: string;
            /**
             * Kind
             * @constant
             */
            kind: "record_responsibility";
            plan: components["schemas"]["RecordingPlan"];
        };
        /** RecordingPlan */
        RecordingPlan: {
            /** Current Outcome */
            current_outcome: string;
            /** Dependencies */
            dependencies: components["schemas"]["ResponsibilityDependency"][];
            next_action: components["schemas"]["ResponsibilityNextAction"];
            /** Next Check In At */
            next_check_in_at: string | null;
            wait: components["schemas"]["ResponsibilityWait"] | null;
        };
        /** ResponsibilityDependency */
        ResponsibilityDependency: {
            /** Expected Version */
            expected_version: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "artifact_revision" | "source_version";
            /** Object Id */
            object_id: string;
        };
        /** ResponsibilityNextAction */
        ResponsibilityNextAction: {
            /** Description */
            description: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "continue_work" | "review_dependency" | "request_decision" | "await_event" | "obtain_grant" | "obtain_tool";
        };
        /** ResponsibilityWait */
        ResponsibilityWait: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "person" | "dependency_change" | "check_in";
            /** Reason */
            reason: string;
        };
        /** TableCell */
        TableCell: {
            /** Field Key */
            field_key: string;
            /** Value */
            value: string | number | boolean | null;
        };
        /** TableRow */
        TableRow: {
            /** Cells */
            cells: components["schemas"]["TableCell"][];
            /** Row Id */
            row_id: string;
        };
        /** ViewBinding */
        ViewBinding: {
            /** Artifact Id */
            artifact_id: string;
            /** Body Hash */
            body_hash: string;
            /** Name */
            name: string;
            /** Revision Id */
            revision_id: string;
        };
        /** WasmCheck */
        WasmCheck: {
            /** Arguments */
            arguments: number[];
            /** Expected */
            expected: string;
            /**
             * Kind
             * @constant
             */
            kind: "wasm_return";
        };
        /** WasmDecision */
        WasmDecision: {
            /** Arguments */
            arguments: number[];
            /** Code */
            code: string;
            /** Entrypoint */
            entrypoint: string;
            /** Input Form */
            input_form: components["schemas"]["FormField"][];
            /**
             * Kind
             * @constant
             */
            kind: "run_wasm";
            target: components["schemas"]["DecisionTarget"] | null;
        };
        /** AlphaDecision */
        AlphaDecision: {
            /** Decision */
            decision: components["schemas"]["AreaReply"] | components["schemas"]["AreaPublish"] | components["schemas"]["AlphaReply"] | components["schemas"]["CSVDecision"] | components["schemas"]["WasmDecision"] | components["schemas"]["PublishDecision"] | components["schemas"]["AlphaStop"] | components["schemas"]["DiscoverCapabilities"] | components["schemas"]["LoadSkill"] | components["schemas"]["ReadContext"] | components["schemas"]["ReadSavedWork"] | components["schemas"]["RecordResponsibility"];
            /** Goal */
            goal: string;
            /** Success Criteria */
            success_criteria: (components["schemas"]["WasmCheck"] | components["schemas"]["CSVCheck"])[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
