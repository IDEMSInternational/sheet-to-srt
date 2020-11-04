class ConversationTranslator {
    uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    generateUUID() {
        return this.uuidv4();
        //return "uuid_" + this.uuidCounter++;
    }
    from(conversationSheets, version = "13", site = "https://rapidpro.idems.international", flowSpecVersion = "13.1.0", flowLanguage = "base", flowType = "messaging", defaultRevision = 0, flowExpireAfterMinutes = 60) {
        let rapidProExportObject = {
            campaigns: [],
            fields: [],
            flows: [],
            groups: [],
            site: site,
            triggers: [],
            version: version
        };
        for (let sheet of conversationSheets) {
            const rows = sheet.rows;
            this.setRowIDs(rows);
            // TODO Also need to consider case of updating an existing flow.
            let flow = {
                name: sheet.sheetName,
                uuid: this.generateUUID(),
                // TODO This metadata should possibly be passed in from the "Content list" Excel sheet.
                spec_version: flowSpecVersion,
                language: flowLanguage,
                type: flowType,
                nodes: [],
                _ui: null,
                revision: defaultRevision,
                expire_after_minutes: flowExpireAfterMinutes,
                metadata: {
                    revision: defaultRevision
                },
                localization: {}
            };
            const nodesById = {};
            for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                const row = rows[rowIndex];
                let nodeId = this.generateUUID();
                row.NodeUUIDForExit = nodeId;
                let actionNode = {
                    "uuid": nodeId,
                    "actions": [],
                    "exits": [this.createEmptyExit()]
                };
                // Additional nodes added for the row e.g. because of a "Go_to" type.
                let additionalNodes = [];
                // This takes care of blank rows which may still be included because they have a row_id.
                // TODO Should more checks be done if Type is undefined but there may be other contents?
                if (row.Type === undefined) {
                    continue;
                }
                else if (row.Type === "Send_message") {
                    if (row.MessageText === undefined) {
                        throw new Error("On row " + row.Row_ID.toString() + ": Message text cannot be blank for Type = Send_message.");
                    }
                    actionNode.actions.push({
                        "attachments": [],
                        "text": row.MessageText,
                        "type": "send_msg",
                        "quick_replies": this.getRowChoices(row),
                        "uuid": this.generateUUID()
                    });
                    row._rapidProNode = actionNode;
                    nodesById[nodeId] = actionNode;
                    if (row.Save_name) {
                        let resultNode = {
                            "uuid": this.generateUUID(),
                            "actions": [],
                            "exits": [this.createEmptyExit()],
                            "router": {
                                "type": "switch",
                                "default_category_uuid": null,
                                "cases": [],
                                "categories": [
                                    {
                                        "uuid": this.generateUUID(),
                                        "name": "All Responses",
                                        "exit_uuid": null
                                    }
                                ],
                                "operand": "@input.text",
                                "wait": {
                                    "type": "msg"
                                },
                                "result_name": row.Save_name // Is this ok to be the same as the variable?
                            }
                        };
                        resultNode.router.default_category_uuid = resultNode.router.categories[0].uuid;
                        resultNode.router.categories[0].exit_uuid = resultNode.exits[0].uuid;
                        additionalNodes.push(resultNode);
                        // The initial node exits to the resultNode
                        actionNode.exits[0].destination_uuid = resultNode.uuid;
                        let saveNode = {
                            "uuid": this.generateUUID(),
                            "actions": [
                                {
                                    "uuid": this.generateUUID(),
                                    "type": "set_contact_field",
                                    "field": {
                                        // Can these be the same?
                                        "key": row.Save_name,
                                        "name": row.Save_name
                                    },
                                    "value": "@results." + row.Save_name
                                }
                            ],
                            "exits": [this.createEmptyExit()]
                        };
                        additionalNodes.push(saveNode);
                        // The initial node exits to the resultNode
                        resultNode.exits[0].destination_uuid = saveNode.uuid;
                        row._rapidProNode = saveNode;
                    }
                }
                else if (row.Type === "Start_new_flow") {
                    actionNode.actions.push({
                        "flow": {
                            "name": row.MessageText,
                            "uuid": this.generateUUID()
                        },
                        "type": "enter_flow",
                        "uuid": this.generateUUID()
                    });
                    this.setEnterFlowRouterAndExits(actionNode);
                    row._rapidProNode = actionNode;
                    nodesById[nodeId] = actionNode;
                }
                else if (row.Type === "Go_to") {
                }
                else {
                    continue;
                    //throw new Error("Unknown Type");
                }
                // Now add connectivity
                if (row.Condition) {
                    this.processRouterRow(row, rows, flow);
                }
                else {
                    // If no condition just add as exit to nodes that this row says it comes from.
                    // For a "Go_to" row set the exit to the NodUUIDForExit of the row mentioned in MessageText.
                    let fromNodes = this.getFromNodes(row, rows);
                    for (let fromNode of fromNodes) {
                        if (row.Type === "Go_to") {
                            // TODO This is repeated when there is a condition as well so could move to separate function.
                            if (!row.MessageText)
                                throw new Error("On row " + row.Row_ID + ": MessageText must contain the row to go to.");
                            let messageTextRows = rows.filter((r) => r.Row_ID = row.MessageText);
                            if (messageTextRows.length === 1) {
                                fromNode.exits[0].destination_uuid = messageTextRows[0].NodeUUIDForExit;
                            }
                            else {
                                throw new Error("On row " + row.Row_ID + ": Cannot find row with Row_ID = " + row.MessageText + " from MessageText column.");
                            }
                        }
                        else {
                            fromNode.exits[0].destination_uuid = nodeId;
                        }
                    }
                }
                // Add this after the condition so that the nodes are in a sensible order when importing into Rapid Pro
                // If Type is "Go_to" then there is no node to add.
                if (row.Type !== "Go_to") {
                    flow.nodes.push(actionNode);
                }
                for (let n of additionalNodes) {
                    flow.nodes.push(n);
                }
            }
            rapidProExportObject.flows.push(flow);
        }
        return rapidProExportObject;
    }
    // Create default required router with 2 cases/categories and 2 exit for an "enter_flow" node.
    setEnterFlowRouterAndExits(node) {
        let exits = [
            {
                "uuid": this.generateUUID(),
                "destination_uuid": null
            },
            {
                "uuid": this.generateUUID(),
                "destination_uuid": null
            }
        ];
        let categories = [
            {
                "uuid": this.generateUUID(),
                "name": "Complete",
                "exit_uuid": exits[0].uuid
            },
            {
                "uuid": this.generateUUID(),
                "name": "Expired",
                "exit_uuid": exits[1].uuid
            }
        ];
        let cases = [
            {
                "uuid": this.generateUUID(),
                "type": "has_only_text",
                "arguments": ["completed"],
                "category_uuid": categories[0].uuid
            },
            {
                "uuid": this.generateUUID(),
                "type": "has_only_text",
                "arguments": ["expired"],
                "category_uuid": categories[1].uuid
            }
        ];
        // TODO Should this always be overwritting the router and exits or adding to them?
        node.router = {
            "cases": cases,
            "categories": categories,
            "operand": "@child.run.status",
            "type": "switch",
            "default_category_uuid": categories[0].uuid
        };
        node.exits = exits;
    }
    setRowIDs(rows) {
        let nullRows = rows.filter((row) => row.Row_ID === undefined);
        if (nullRows.length == rows.length) {
            for (var i = 0; i <= rows.length - 1; i++) {
                rows[i].Row_ID = (i + 2).toString();
            }
        }
        else if (nullRows.length == 0) {
            if (new Set(rows.map((row) => row.Row_ID)).size !== rows.length) {
                throw new Error("Row_ID values are not unique.");
            }
        }
        else if (nullRows.length !== rows.length) {
            throw new Error("Row_ID column has blank values. If Row_ID is included all rows must have a unique row ID.");
        }
    }
    getFromRowIndices(row) {
        if (row.From) {
            return row.From.toString().split(",");
        }
        return [];
    }
    getFromRows(row, rows) {
        let ind = this.getFromRowIndices(row);
        return rows.filter((curr_row) => ind.includes(curr_row.Row_ID.toString()));
    }
    getFromNodes(row, rows) {
        return this.getFromRows(row, rows)
            .map((row) => row._rapidProNode)
            .filter((node) => node !== undefined);
    }
    getRoutersFromRow(currentRow, rows, nodesById) {
        const fromNodes = this.getFromNodes(currentRow, rows);
        let fromNodeExits = [];
        for (let fromNode of fromNodes) {
            for (let exit of fromNode.exits) {
                fromNodeExits.push(exit);
            }
        }
        return fromNodeExits
            .filter((exit) => exit.destination_uuid)
            .map((exit) => nodesById[exit.destination_uuid])
            .filter((node) => node.router);
    }
    attachToUnattachedCategories(routerNode, newExit) {
        let routerCategoriesWithoutExits = routerNode.router.cases.map((routerCase) => {
            return routerNode.router.categories.find((cat) => cat.uuid === routerCase.category_uuid);
        })
            .filter((category) => !category.exit_uuid);
        routerNode.exits.push(newExit);
        routerCategoriesWithoutExits.forEach((category) => {
            category.exit_uuid = newExit.uuid;
        });
    }
    createEmptyExit() {
        let exit = {
            uuid: this.generateUUID(),
            destination_uuid: null
        };
        return exit;
    }
    createRouterNode(operandType, operandValue, routerType = "switch", defaultName = "All Responses") {
        let nodeId = this.generateUUID();
        let emptyExit = this.createEmptyExit();
        let otherCategory = {
            exit_uuid: emptyExit.uuid,
            name: defaultName,
            uuid: this.generateUUID()
        };
        let newRouterNode = {
            "uuid": nodeId,
            "actions": [],
            "router": {
                "type": routerType,
                "default_category_uuid": otherCategory.uuid,
                "cases": [],
                "categories": [otherCategory],
                "operand": operandType + "." + operandValue
            },
            "exits": [emptyExit]
        };
        if (operandType === "@input") {
            newRouterNode.router.wait = {
                type: "msg"
            };
        }
        return newRouterNode;
    }
    // Adds a condition to a router node based on the condition information in a row.
    addConditionToRouterNode(routerNode, row, rows, 
    // TODO This could be more global?
    defaultType = "has_only_phrase") {
        let type;
        if (row.Condition_Type) {
            type = row.Condition_Type;
        }
        else
            type = defaultType;
        let choiceCategory;
        // If row has a condition then add a new category, case and exit.
        if (row.Condition) {
            let conds;
            if (row.Condition.includes(",")) {
                conds = row.Condition.split(",").map(s => s.trim());
            }
            else if (row.Condition.includes(";")) {
                conds = row.Condition.split(";").map(s => s.trim());
            }
            else
                conds = [row.Condition];
            if (routerNode.actions.length > 0 && routerNode.actions[0].type === "enter_flow") {
                if (conds.length === 2 && conds.includes("completed") && conds.includes("expired")) {
                    routerNode.exits[0].destination_uuid = row.NodeUUIDForExit;
                    routerNode.exits[1].destination_uuid = row.NodeUUIDForExit;
                }
                else if (conds.length === 1 && conds.includes("completed")) {
                    routerNode.exits[0].destination_uuid = row.NodeUUIDForExit;
                }
                else if (conds.length === 1 && conds.includes("expired")) {
                    routerNode.exits[1].destination_uuid = row.NodeUUIDForExit;
                }
                else
                    throw new Error("Condition for a Start_new_flow can only be: completed, expired or both.");
            }
            else {
                let exit = this.createEmptyExit();
                if (row.Type === "Go_to") {
                    // TODO This is repeated when there is no condition as well so could move to separate function.
                    if (!row.MessageText)
                        throw new Error("On row " + row.Row_ID + ": MessageText must contain the row to go to.");
                    let messageTextRows = rows.filter((r) => r.Row_ID === row.MessageText);
                    if (messageTextRows.length === 1) {
                        exit.destination_uuid = messageTextRows[0].NodeUUIDForExit;
                    }
                    else {
                        throw new Error("On row " + row.Row_ID + ": Cannot find row with Row_ID = " + row.MessageText + " from MessageText column.");
                    }
                }
                else {
                    exit.destination_uuid = row.NodeUUIDForExit;
                }
                choiceCategory = {
                    exit_uuid: exit.uuid,
                    name: row.Condition,
                    uuid: this.generateUUID()
                };
                let choiceCases = [];
                // For "has_any_word" arguments is a list of length one with all words separate by spaces.
                if (type === "has_any_word") {
                    conds = [conds.join(" ")];
                    choiceCases = [
                        {
                            "arguments": conds,
                            "category_uuid": choiceCategory.uuid,
                            "type": type,
                            "uuid": this.generateUUID()
                        }
                    ];
                    // For phrases need one case per phrase linked to the same category. arguments is a list of length one with the phrase.
                }
                else if (type === "has_only_phrase" || type === "has_phrase") {
                    for (let con of conds) {
                        choiceCases.push({
                            "arguments": [con],
                            "category_uuid": choiceCategory.uuid,
                            "type": type,
                            "uuid": this.generateUUID()
                        });
                    }
                }
                else {
                    // TODO Other types needs to be implemented. This is not correct for all other types.
                    conds = [conds.join(" ")];
                    choiceCases = [
                        {
                            "arguments": conds,
                            "category_uuid": choiceCategory.uuid,
                            "type": type,
                            "uuid": this.generateUUID()
                        }
                    ];
                }
                routerNode.exits.push(exit);
                routerNode.router.categories.push(choiceCategory);
                for (let c of choiceCases) {
                    routerNode.router.cases.push(c);
                }
            }
        }
        else {
            // If the row has no condition then update the default (other) exit.
            // Routers are always created with a default (empty) exit so this always exists.
            routerNode.exits[0].destination_uuid = row.NodeUUIDForExit;
        }
    }
    processRouterRow(row, rows, flow) {
        let fromNodes = this.getFromNodes(row, rows);
        let fromRows;
        let routerNode;
        let newRouterNode;
        let first = true;
        let operandType;
        let operandValue;
        fromRows = this.getFromRows(row, rows);
        // If Condition_Var is given this is operandValue
        if (row.Condition_Var && row.Condition_Var.length > 0) {
            operandType = "@fields";
            operandValue = row.Condition_Var;
            // If the first fromRow has a Save_name then the condition is from a saved field.
        }
        else if (fromRows && fromRows.length > 0 && fromRows[0].Save_name) {
            operandType = "@fields";
            operandValue = fromRows[0].Save_name;
            // If there is no Condition_Var and fromNode is not of type "set_contact_field" then assumed to be input from text.
        }
        else {
            operandType = "@input";
            operandValue = "text";
        }
        // Each "from row/node" needs to have it's exits update with a router (could be new or existing router)
        for (let fromNode of fromNodes) {
            // If fromNode is a router of the same type as the current node/row then add a condition to fromNode for the current row/node
            if (fromNode.router && fromNode.router.type == "switch" && fromNode.router.operand && fromNode.router.operand == operandType + "." + operandValue) {
                this.addConditionToRouterNode(fromNode, row, rows);
            }
            else {
                // If fromNode is not a router or router of a different type then create a new router of the same type and add a condition for the current row/node.
                // Only one new router is created for all fromNodes so that all fromNodes go to the same router.
                // There may be cases where multiple routers may be desired, but this can be done by ordering the rows of the Excel sheet to have different router cases first.
                // TODO Create an example Excel file to demonstate this.
                if (first) {
                    newRouterNode = this.createRouterNode(operandType, operandValue);
                    this.addConditionToRouterNode(newRouterNode, row, rows);
                    flow.nodes.push(newRouterNode);
                    first = false;
                }
                routerNode = newRouterNode;
                // If fromNode is a router of a different type then in parent If then set the "other" exit to the new router
                // If fromNode is not a router and has exactly 1 exit then the fromNode now goes to the new router and the existing exit of fromNode is now the "other" of the router
                // If fromNode has multiple exits but is not a router than this is not valid.
                if (fromNode.router) {
                    if (fromNode.exits[0].destination_uuid) {
                        // How should we throw errors?
                        // Should give details of both exits.
                        throw new Error("Attempting to set multiple default exits");
                    }
                    fromNode.exits[0].destination_uuid = routerNode.uuid;
                }
                else if (fromNode.exits.length == 1) {
                    // Takes 
                    let oldExitDestUuid = fromNode.exits[0].destination_uuid;
                    fromNode.exits[0].destination_uuid = routerNode.uuid;
                    routerNode.exits[0].destination_uuid = oldExitDestUuid;
                }
                else {
                    // How should we throw errors?
                    throw new Error("Multiple exists defined but node is not a router");
                }
                // Update the rows which currently link to fromNode to now link to routerNode.
                // This ensures that the next time these rows are updated the are correctly linked to routerNode.
                let fromRows = rows.filter((row) => row._rapidProNode == fromNode);
                // This may or may not be a concern if fromNode is not linked to exactly 1 row.
                if (fromRows.length !== 1)
                    throw new console.warn("A node is attached to " + fromRows.length.toString() + " rows.");
                for (let fromRow of fromRows) {
                    fromRow._rapidProNode = routerNode;
                }
            }
        }
    }
    getRowChoices(row) {
        let quick_replies = [];
        for (var i = 1; i <= 12; i++) {
            if (row["Choice_" + i] !== undefined) {
                quick_replies.push(row["Choice_" + i].toString());
            }
        }
        return quick_replies;
    }
}
const toolboxTopicNames = [
    {
        type: "ONE_ON_ONE_TIME",
        languageCode: "en",
        name: "One-on-One Time",
        buttonColor: "#F7911E"
    },
    {
        type: "PRAISE_AND_POSITIVE_REINFORCEMENT",
        languageCode: "en",
        name: "Praise & Positive Reinforcement",
        buttonColor: "#ED1651"
    },
    {
        type: "MANAGING_ANGER_AND_STRESS",
        languageCode: "en",
        name: "Managing Anger & Stress",
        buttonColor: "#5652A3"
    },
    {
        type: "FAMILY_BUDGETING",
        languageCode: "en",
        name: "Family Budgeting",
        buttonColor: "#8885D1"
    },
    {
        type: "RULES_AND_ROUTINES",
        languageCode: "en",
        name: "Rules & Routines",
        buttonColor: "#54C5D0"
    },
    {
        type: "ACCEPTING_RESPONSIBILITY",
        languageCode: "en",
        name: "Accepting Responsibilities",
        buttonColor: "#0F8AB2"
    },
    {
        type: "PROBLEM_SOLVING",
        languageCode: "en",
        name: "Problem Solving",
        buttonColor: "#2E9E48"
    },
    {
        type: "RISK_MAPPING_AND_DEALING_WITH_CRISIS",
        languageCode: "en",
        name: "Risk Mapping & Dealing with Crisis",
        buttonColor: "#227535"
    }
];
class ToolboxTranslator {
    getTopicMetadata(id) {
        return toolboxTopicNames.find((topicMetadata) => topicMetadata.type === id);
    }
    from(toolboxSheets) {
        let topicByType = {};
        for (let sheet of toolboxSheets) {
            let topicMetadata = this.getTopicMetadata(sheet.topicId);
            if (topicMetadata) {
                if (!topicByType[topicMetadata.type]) {
                    topicByType[topicMetadata.type] = {
                        metadata: topicMetadata,
                        contentSections: []
                    };
                }
                topicByType[topicMetadata.type].contentSections.push(this.sheetToContentSection(sheet));
            }
        }
        let topicTypes = Object.keys(topicByType);
        return {
            topics: topicTypes.map((type) => topicByType[type])
        };
    }
    sheetToContentSection(sheet) {
        let elements = [];
        let title = sheet.sheetName;
        let listElement;
        for (let row of sheet.rows) {
            switch (row.Type) {
                case "Title": {
                    title = row.MessageText;
                    break;
                }
                case "Core_tip": {
                    elements.push({
                        type: "CORE_TIP",
                        text: row.MessageText
                    });
                    break;
                }
                case "List_intro": {
                    listElement = this.createEmptyList();
                    listElement.intro = row.MessageText;
                    break;
                }
                case "End_list": {
                    if (listElement) {
                        listElement.items = listElement.items
                            .filter((item) => item.body.length > 0 || item.heading.length > 0);
                        elements.push(listElement);
                    }
                    listElement = null;
                    break;
                }
                case "List_item": {
                    if (!listElement) {
                        listElement = this.createEmptyList();
                    }
                    listElement.items.push({
                        heading: row.MessageText,
                        body: ""
                    });
                    break;
                }
                case "Text":
                default: {
                    if (listElement) {
                        const lastItem = listElement.items[listElement.items.length - 1];
                        if (lastItem.body.length > 0) {
                            lastItem.body += "\n";
                        }
                        lastItem.body += row.MessageText;
                    }
                    else {
                        elements.push({
                            type: "TEXT",
                            text: row.MessageText
                        });
                    }
                }
            }
        }
        return {
            elements: elements,
            title: title
        };
    }
    createEmptyList() {
        return {
            type: "LIST",
            intro: "",
            items: []
        };
    }
    to(toolboxExport) {
        return [];
    }
}
function processWorkbook(workbook) {
    console.log("Sheet names", workbook.SheetNames);
    let contentListSheetName = "==Content_List==";
    if (!workbook.Sheets[contentListSheetName]) {
        console.error("No content list sheet!");
        return;
    }
    const contentList = XLSX.utils.sheet_to_json(workbook.Sheets[contentListSheetName]);
    console.log("Content list", contentList);
    const conversationSheets = contentList
        .filter((contentListItem) => contentListItem.Flow_Type === "Conversation")
        .filter((contentListItem) => workbook.Sheets[contentListItem.Flow_Name])
        .map((contentListItem) => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[contentListItem.Flow_Name]);
        return {
            sheetName: contentListItem.Flow_Name,
            rows: rows
        };
    });
    console.log("Conversation Sheets: ", JSON.stringify(conversationSheets));
    const conversationTranslator = new ConversationTranslator();
    const rapidProExportObject = conversationTranslator.from(conversationSheets);
    const rapidProExportJSONString = JSON.stringify(rapidProExportObject, null, 4);
    const toolboxSheets = contentList
        .filter((contentListItem) => contentListItem.Flow_Type === "Toolbox")
        .filter((contentListItem) => workbook.Sheets[contentListItem.Flow_Name])
        .map((contentListItem) => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[contentListItem.Flow_Name]);
        return {
            sheetName: contentListItem.Flow_Name,
            topicId: contentListItem.Topic_Id,
            rows: rows
        };
    });
    const toolboxTranslator = new ToolboxTranslator();
    const toolboxJSON = toolboxTranslator.from(toolboxSheets);
    const toolboxJSONString = JSON.stringify(toolboxJSON, null, 4);
    return { rpJSONString: rapidProExportJSONString, toolboxJSONString: toolboxJSONString };
}
