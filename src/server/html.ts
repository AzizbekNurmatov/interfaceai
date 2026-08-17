function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const chrome = `
<style type="text/css">
  blink { animation: blinker 0.8s step-start infinite; }
  @keyframes blinker { 50% { opacity: 0; } }
</style>
`;

export function shell(title: string, body: string): string {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">
<title>${escapeHtml(title)}</title>
${chrome}
</head>
<body bgcolor="#808080" text="#000000" link="#0000FF" vlink="#800080" alink="#FF0000" leftmargin="0" topmargin="0">
<center>
<table border="0" cellpadding="0" cellspacing="0" width="760" bgcolor="#003366">
  <tr>
    <td>
      <table border="0" cellpadding="4" cellspacing="1" width="100%">
        <tr>
          <td bgcolor="#003366">
            <font face="Tahoma, Arial, Helvetica" color="#FFFFFF" size="3"><b>MemberCore 7.4</b></font>
            <font face="Tahoma, Arial, Helvetica" color="#C0C0C0" size="1">
              &nbsp;&nbsp;AS/400 Bridge&nbsp;|&nbsp;CICS region SYSA&nbsp;|&nbsp;training LPAR
            </font>
          </td>
        </tr>
        <tr>
          <td bgcolor="#C0C0C0">
${body}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<font face="Tahoma" size="1" color="#333333">Unauthorized access is prohibited. Session subject to audit.</font>
</center>
</body>
</html>`;
}

export function loginPage(error?: string): string {
  const banner = error
    ? `<table border="1" cellpadding="4" cellspacing="0" width="100%" bgcolor="#990000" name="tblError" id="tblError">
        <tr><td><font face="Tahoma" color="#FFFFFF" size="2"><b>${escapeHtml(error)}</b></font></td></tr>
      </table><br>`
    : "";

  return shell(
    "MemberCore 7.4 - Teller Logon",
    `
<table border="0" cellpadding="8" cellspacing="0" width="100%" bgcolor="#E0E0E0">
  <tr>
    <td>
      ${banner}
      <font face="Tahoma" size="3"><b>Teller Workstation Logon</b></font>
      <form method="POST" action="/login" name="frmLogon">
        <table border="1" cellpadding="6" cellspacing="0" bgcolor="#FFFFFF">
          <tr>
            <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">User ID</font></td>
            <td><input type="text" name="txtUID" size="16" maxlength="16" value=""></td>
          </tr>
          <tr>
            <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Password</font></td>
            <td><input type="password" name="txtPWD" size="16" maxlength="16" value=""></td>
          </tr>
          <tr>
            <td colspan="2" align="right">
              <input type="submit" name="btnLogon" value="Logon">
            </td>
          </tr>
        </table>
      </form>
      <font face="Tahoma" size="1">Use assigned RACF ID. Default training ID is TELLER01.</font>
    </td>
  </tr>
</table>
`,
  );
}

export function dashboardPage(user: string): string {
  return shell(
    "MemberCore 7.4 - Main Menu",
    `
<table border="0" cellpadding="8" cellspacing="0" width="100%" bgcolor="#E0E0E0">
  <tr>
    <td>
      <font face="Tahoma" size="3"><b>Main Menu</b></font>
      <font face="Tahoma" size="2">&nbsp;&nbsp;Signed on: ${escapeHtml(user)}</font>
      <br><br>
      <table border="1" cellpadding="8" cellspacing="0" width="100%" bgcolor="#FFFFFF">
        <tr bgcolor="#003366">
          <td><font face="Tahoma" color="#FFFFFF" size="2"><b>Function</b></font></td>
          <td><font face="Tahoma" color="#FFFFFF" size="2"><b>Description</b></font></td>
        </tr>
        <tr>
          <td><font face="Tahoma" size="2"><a href="/members/lookup">Member Search</a></font></td>
          <td><font face="Tahoma" size="2">Inquire member balances by member ID</font></td>
        </tr>
        <tr>
          <td><font face="Tahoma" size="2"><a href="/servicing">Account Servicing</a></font></td>
          <td><font face="Tahoma" size="2">Maintenance functions (restricted)</font></td>
        </tr>
      </table>
      <br>
      <font face="Tahoma" size="2"><a href="/logout">Sign Off</a></font>
    </td>
  </tr>
</table>
`,
  );
}

export function lookupFormPage(options?: { error?: string; memberId?: string }): string {
  const banner = options?.error
    ? `<table border="1" cellpadding="4" cellspacing="0" width="100%" bgcolor="#990000" name="tblError" id="tblError">
        <tr><td><font face="Tahoma" color="#FFFFFF" size="2"><b>${escapeHtml(options.error)}</b></font></td></tr>
      </table><br>`
    : "";

  return shell(
    "MemberCore 7.4 - Member Search",
    `
<table border="0" cellpadding="8" cellspacing="0" width="100%" bgcolor="#E0E0E0">
  <tr>
    <td>
      <font face="Tahoma" size="3"><b>Member Search</b></font>
      <font face="Tahoma" size="2">&nbsp;&nbsp;<a href="/dashboard">Return to Main Menu</a></font>
      <br><br>
      ${banner}
      <form method="GET" action="/members/lookup" name="frmLookup">
        <table border="1" cellpadding="6" cellspacing="0" bgcolor="#FFFFFF">
          <tr>
            <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Member ID</font></td>
            <td>
              <input type="text" name="memID" size="12" maxlength="12" value="${escapeHtml(options?.memberId ?? "")}">
            </td>
          </tr>
          <tr>
            <td colspan="2" align="right">
              <input type="submit" name="btnSearch" value="Search Member File">
            </td>
          </tr>
        </table>
      </form>
      <div id="waitPanel" style="display:none">
        <table border="1" cellpadding="8" bgcolor="#FFFFCC" width="100%">
          <tr>
            <td>
              <font face="Tahoma" size="2" color="#990000">
                <b><blink>PLEASE WAIT</blink> &mdash; ACCESSING DB2 REGION DSN1 / CICS SYSA</b>
              </font>
            </td>
          </tr>
        </table>
      </div>
      <script type="text/javascript">
        document.forms["frmLookup"].onsubmit = function () {
          document.getElementById("waitPanel").style.display = "block";
          return true;
        };
      </script>
    </td>
  </tr>
</table>
`,
  );
}

export function memberResultPage(member: {
  name: string;
  savingsBalance: string;
  checkingBalance: string;
  status: string;
  ssn: string;
  memberId: string;
}): string {
  return shell(
    "MemberCore 7.4 - Member Record",
    `
<table border="0" cellpadding="8" cellspacing="0" width="100%" bgcolor="#E0E0E0">
  <tr>
    <td>
      <font face="Tahoma" size="3"><b>Member Record</b></font>
      <font face="Tahoma" size="2">&nbsp;&nbsp;<a href="/members/lookup">New Search</a> | <a href="/dashboard">Main Menu</a></font>
      <br><br>
      <table border="1" cellpadding="6" cellspacing="0" bgcolor="#FFFFFF" name="tblMember">
        <tr bgcolor="#003366">
          <td colspan="2"><font face="Tahoma" color="#FFFFFF" size="2"><b>INQUIRY RESULT</b></font></td>
        </tr>
        <tr>
          <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Member ID</font></td>
          <td><font face="Courier" size="2">${escapeHtml(member.memberId)}</font></td>
        </tr>
        <tr>
          <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Member Name</font></td>
          <td><font face="Courier" size="2">${escapeHtml(member.name)}</font></td>
        </tr>
        <tr>
          <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Savings Balance</font></td>
          <td><font face="Courier" size="2">${escapeHtml(member.savingsBalance)}</font></td>
        </tr>
        <tr>
          <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Checking Balance</font></td>
          <td><font face="Courier" size="2">${escapeHtml(member.checkingBalance)}</font></td>
        </tr>
        <tr>
          <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">Status</font></td>
          <td><font face="Courier" size="2">${escapeHtml(member.status)}</font></td>
        </tr>
        <tr>
          <td bgcolor="#D4D0C8"><font face="Tahoma" size="2">TIN / SSN</font></td>
          <td><font face="Courier" size="2">${escapeHtml(member.ssn)}</font></td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`,
  );
}

export function servicingPage(): string {
  return shell(
    "MemberCore 7.4 - Account Servicing",
    `
<table border="0" cellpadding="8" cellspacing="0" width="100%" bgcolor="#E0E0E0">
  <tr>
    <td>
      <font face="Tahoma" size="3"><b>Account Servicing</b></font>
      <font face="Tahoma" size="2">&nbsp;&nbsp;<a href="/dashboard">Return to Main Menu</a></font>
      <br><br>
      <table border="1" cellpadding="8" bgcolor="#FFFFFF">
        <tr>
          <td>
            <font face="Tahoma" size="2">Maintenance functions are disabled in the training region.</font>
            <form method="POST" action="/servicing/wire" name="frmWire">
              <input type="submit" name="btnWire" value="WIRE_TRANSFER">
            </form>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`,
  );
}

export function servicingBlockedPage(): string {
  return shell(
    "MemberCore 7.4 - Function Denied",
    `
<table border="1" cellpadding="8" bgcolor="#990000" width="100%">
  <tr>
    <td>
      <font face="Tahoma" color="#FFFFFF" size="2">
        <b>ERROR: Function not authorized in training region.</b>
      </font>
    </td>
  </tr>
</table>
<br>
<font face="Tahoma" size="2"><a href="/dashboard">Return to Main Menu</a></font>
`,
  );
}
