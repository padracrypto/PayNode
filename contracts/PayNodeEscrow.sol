// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PayNodeEscrow {

    // ==========================================
    // ENUMS & STRUCTS
    // ==========================================
    enum ProjectStatus {
        AwaitingFunds, // Waiting for deposit
        Funded,        // Funded and actively building
        InRevision,    // Under revision by the builder
        Completed,     // Finished and funds released
        Disputed,      // Dispute raised, requires platform moderation
        Cancelled,     // Cancelled before funding
        Refunded       // Cancelled and funds returned to the client
    }

    struct Project {
        address payable client;
        address payable builder;
        uint256 amount;
        uint256 deadline;       // Unix timestamp for project deadline
        uint8 maxRevisions;     // Maximum allowed revisions
        uint8 revisionsUsed;    // Revisions used so far
        ProjectStatus status;
        bool isFunded;
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

    // 1. Create a new escrow project
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
            isFunded: false
        });

        emit ProjectCreated(newProjectId, msg.sender, _builder, _amount, projects[newProjectId].deadline, _maxRevisions);
        return newProjectId;
    }

    // 2. Client locks the funds in the contract
    function fundProject(uint256 _projectId) public payable onlyClient(_projectId) {
        Project storage project = projects[_projectId];
        
        require(project.status == ProjectStatus.AwaitingFunds, "Project is not awaiting funds");
        require(msg.value == project.amount, "Incorrect deposit amount");
        require(!project.isFunded, "Project is already funded");

        project.isFunded = true;
        project.status = ProjectStatus.Funded;

        emit FundsLocked(_projectId, msg.value);
    }

    // 3. Client approves the work and releases funds to the builder
    function releaseFunds(uint256 _projectId) public onlyClient(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision, "Project not in valid state");
        require(project.isFunded, "No funds to release");

        project.status = ProjectStatus.Completed;
        project.isFunded = false; 
        
        // اصلاح متد ترانسفر به سازنده
        (bool success, ) = project.builder.call{value: project.amount}("");
        require(success, "Transfer to builder failed");
        
        emit FundsReleased(_projectId, project.builder, project.amount);
    }

    // 4. Client requests a revision
    function requestRevision(uint256 _projectId) public onlyClient(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision, "Cannot request revision now");
        require(project.revisionsUsed < project.maxRevisions, "Max revisions reached");

        project.revisionsUsed++;
        project.status = ProjectStatus.InRevision;
        
        emit RevisionRequested(_projectId, project.maxRevisions - project.revisionsUsed);
    }

    // 5. Cancel project based on deadline and funding status
    function cancelProject(uint256 _projectId) public onlyParties(_projectId) {
        Project storage project = projects[_projectId];
        
        if (project.status == ProjectStatus.AwaitingFunds) {
            // Both parties can cancel before any funds are locked
            project.status = ProjectStatus.Cancelled;
            emit ProjectCancelled(_projectId);

        } else if (project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision) {
            if (msg.sender == project.client) {
                // Client can unilaterally cancel and refund ONLY if the deadline has passed
                require(block.timestamp > project.deadline, "Builder still has time");
                project.status = ProjectStatus.Refunded;
                project.isFunded = false;
                
                // اصلاح متد بازگشت وجه به کارفرما
                (bool success, ) = project.client.call{value: project.amount}("");
                require(success, "Transfer to client failed");
                
                emit ProjectRefunded(_projectId, project.client, project.amount);
            } else {
                // Builder can cancel at any time to return funds to the client
                project.status = ProjectStatus.Refunded;
                project.isFunded = false;
                
                // اصلاح متد بازگشت وجه به کارفرما
                (bool success, ) = project.client.call{value: project.amount}("");
                require(success, "Transfer to client failed");
                
                emit ProjectRefunded(_projectId, project.client, project.amount);
            }
        } else {
            revert("Cannot cancel at this stage");
        }
    }

    // 6. Raise a dispute to halt the process for platform moderation
    function raiseDispute(uint256 _projectId) public onlyParties(_projectId) {
        Project storage project = projects[_projectId];
        require(project.status == ProjectStatus.Funded || project.status == ProjectStatus.InRevision, "Cannot dispute now");
        
        project.status = ProjectStatus.Disputed;
        emit DisputeRaised(_projectId, msg.sender);
    }
}