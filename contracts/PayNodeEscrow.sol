// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PayNodeEscrow {

    // ==========================================
    // ENUMS & STRUCTS
    // ==========================================
    enum ProjectStatus {
        AwaitingFunds, // 0: Waiting for deposit
        Funded,        // 1: Funded and actively building
        InRevision,    // 2: Under revision by the builder
        Completed,     // 3: Finished and funds released
        Disputed,      // 4: Dispute raised, requires platform moderation
        Cancelled,     // 5: Cancelled before funding
        Refunded,      // 6: Cancelled and funds returned to the client
        Delivered      // 7: Work delivered, waiting for client review
    }

    struct Project {
        address payable client;
        address payable builder;
        uint256 amount;
        uint256 deadline;       
        uint8 maxRevisions;     
        uint8 revisionsUsed;    
        ProjectStatus status;
        bool isFunded;
        uint256 deliveredAt;
    }

    // ==========================================
    // STATE VARIABLES
    // ==========================================
    uint256 public projectCounter;
    mapping(uint256 => Project) public projects;

    // ==========================================
    // EVENTS
    // ==========================================
    event ProjectCreated(uint256 indexed projectId, address indexed client, address indexed builder, uint256 amount, uint256 deadline, uint8 maxRevisions);
    event FundsLocked(uint256 indexed projectId, uint256 amount);
    event FundsReleased(uint256 indexed projectId, address indexed builder, uint256 amount);
    event ProjectCancelled(uint256 indexed projectId);
    event ProjectRefunded(uint256 indexed projectId, address indexed client, uint256 amount);
    event RevisionRequested(uint256 indexed projectId, uint8 revisionsLeft);
    event DisputeRaised(uint256 indexed projectId, address raisedBy);
    event WorkDelivered(uint256 indexed projectId, uint256 deliveredAt);

    // ==========================================
    // MODIFIERS
    // ==========================================
    modifier onlyClient(uint256 _projectId) {
        require(msg.sender == projects[_projectId].client, "Not the client");
        _;
    }

    modifier onlyBuilder(uint256 _projectId) {
        require(msg.sender == projects[_projectId].builder, "Not the builder");
        _;
    }

    modifier onlyParties(uint256 _projectId) {
        require(msg.sender == projects[_projectId].client || msg.sender == projects[_projectId].builder, "Not a party");
        _;
    }

    // ==========================================
    // CORE FUNCTIONS
    // ==========================================

    function createProject(
        address payable _builder, 
        uint256 _amount, 
        uint256 _durationInDays, 
        uint8 _maxRevisions
    ) public returns (uint256) {
        require(_builder != address(0), "Invalid builder address");
        require(_builder != msg.sender, "Client and builder cannot be the same");
        require(_amount > 0, "Amount must be greater than zero");
        require(_durationInDays > 0, "Duration must be valid");

        projectCounter++;
        uint256 newProjectId = projectCounter;

        projects[newProjectId] = Project({
            client: payable(msg.sender),
            builder: _builder,
            amount: _amount,
            deadline: block.timestamp + (_durationInDays * 1 days),
            maxRevisions: _maxRevisions,
            revisionsUsed: 0,
            status: ProjectStatus.AwaitingFunds,
            isFunded: false,
            deliveredAt: 0
        });

        emit ProjectCreated(newProjectId, msg.sender, _builder, _amount, projects[newProjectId].deadline, _maxRevisions);
        return newProjectId;
    }

    function fundProject(uint256 _projectId) public payable onlyClient(_projectId) {
        Project storage project = projects[_projectId];
        
        require(project.status == ProjectStatus.AwaitingFunds, "Project is not awaiting funds");
        require(msg.value == project.amount, "Incorrect deposit amount");
        require(!project.isFunded, "Project is already funded");

        project.isFunded = true;
        project.status = ProjectStatus.Funded;

        emit FundsLocked(_projectId, msg.value);
    }

    function markDelivered(uint256 _projectId) public onlyBuilder(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision, "Project not in active state");
        
        project.status = ProjectStatus.Delivered;
        project.deliveredAt = block.timestamp;

        emit WorkDelivered(_projectId, project.deliveredAt);
    }

    function releaseFunds(uint256 _projectId) public onlyClient(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision || project.status == ProjectStatus.Delivered, "Project not in valid state");
        require(project.isFunded, "No funds to release");

        project.status = ProjectStatus.Completed;
        project.isFunded = false; 
        
        (bool success, ) = project.builder.call{value: project.amount}("");
        require(success, "Transfer to builder failed");
        
        emit FundsReleased(_projectId, project.builder, project.amount);
    }

    function claimByBuilder(uint256 _projectId) public onlyBuilder(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Delivered, "Work must be delivered first");
        require(project.isFunded, "No funds to release");
        require(block.timestamp >= project.deliveredAt + 7 days, "7-day review period is not over yet");

        project.status = ProjectStatus.Completed;
        project.isFunded = false;

        (bool success, ) = project.builder.call{value: project.amount}("");
        require(success, "Transfer to builder failed");

        emit FundsReleased(_projectId, project.builder, project.amount);
    }

    function requestRevision(uint256 _projectId) public onlyClient(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision || project.status == ProjectStatus.Delivered, "Cannot request revision now");
        require(project.revisionsUsed < project.maxRevisions, "Max revisions reached");

        project.revisionsUsed++;
        project.status = ProjectStatus.InRevision;
        
        emit RevisionRequested(_projectId, project.maxRevisions - project.revisionsUsed);
    }

    function cancelProject(uint256 _projectId) public onlyParties(_projectId) {
        Project storage project = projects[_projectId];
        
        if (project.status == ProjectStatus.AwaitingFunds) {
            project.status = ProjectStatus.Cancelled;
            emit ProjectCancelled(_projectId);
        } else if (project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision) {
            if (msg.sender == project.client) {
                require(block.timestamp > project.deadline, "Builder still has time");
                project.status = ProjectStatus.Refunded;
                project.isFunded = false;
                
                (bool success, ) = project.client.call{value: project.amount}("");
                require(success, "Transfer to client failed");
                
                emit ProjectRefunded(_projectId, project.client, project.amount);
            } else {
                project.status = ProjectStatus.Refunded;
                project.isFunded = false;
                
                (bool success, ) = project.client.call{value: project.amount}("");
                require(success, "Transfer to client failed");
                
                emit ProjectRefunded(_projectId, project.client, project.amount);
            }
        } else {
            revert("Cannot cancel at this stage");
        }
    }

    function raiseDispute(uint256 _projectId) public onlyParties(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision || project.status == ProjectStatus.Delivered, "Cannot dispute now");
        
        project.status = ProjectStatus.Disputed;
        emit DisputeRaised(_projectId, msg.sender);
    }
}