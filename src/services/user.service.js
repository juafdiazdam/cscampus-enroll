import fetch from "node-fetch";
import axios from 'axios';
import formidable from "formidable";
import fs from 'fs'
import { fileURLToPath } from 'url';
import path from 'path';
import pool from "../database.js"
import enrollmentGroups from '../config/courses.js';
import { sendEmailToUser, sendInternalEmail } from '../config/sendMail.js';

var WebServiceUrl = process.env.MDL_DOMAIN + "webservice/rest/server.php";

export const newRecord = async (req, res, next) => {
    let fecha_now = new Date(); //Fecha Actual
    var mlSeconds = 24*60*60000;
    var newDateObj = new Date(fecha_now - mlSeconds);
    var formData = new formidable.IncomingForm();
	formData.parse(req, async (error, fields, files) => {
        const {firstname, lastname, institution, country, role, course, email, phone} = fields;
        var filename = email +"-"+ files.file.originalFilename;
        const file = files.file;
        fs.readFile(file.filepath, async (err, data) => { //Se lee el archivo desde temp y se inserta el buffer como data en sharepoint.
            var spAccessToken = await getSpAccessToken();
            var uploadSpFile = await sendFileToSp(data, filename, spAccessToken.data.access_token);
          });
        const newUser = {firstname, lastname, institution, country, role, course, email, phone};
        //consultamos si existen solicitudes recientes en la base de datos, mínimo 24 hrs.
        var user = await pool.query(`SELECT * FROM request WHERE submitted_at BETWEEN "${newDateObj.toISOString()}" AND "${fecha_now.toISOString()}" AND email = "${newUser.email}"`);
        console.log(user);
        if(user.length == 0)
        {
            await pool.query('INSERT INTO request set ?', [newUser]);
            console.log("Nuevo registro exitoso" + newUser.email);
            await sendEmailToUser(newUser);
            await sendInternalEmail(newUser);
            res.redirect('/user/success');
        }else{
            console.log("Debes esperar al menos 24 horas para enviar una nueva solicitud");
            res.redirect('/user/not-success');
        }
    });
}

export const fileTest = async(req, res, next) => {
    const form = new formidable.IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error("aca el error");
        return;
      }
      var filename = files.file.originalFilename;
      const file = files.file;
      fs.readFile(file.filepath, async (err, data) => {
        if (err) {
          console.error("aca el error");
          return;
        }
        var spAccessToken = await getSpAccessToken();
        var uploadSpFile = await sendFileToSp(data, filename, spAccessToken.data.access_token);
        console.log(data);
      });
    });
}

export const queryUserdb = async (req, res, next) => {
    var users = await pool.query('SELECT * from users WHERE username = "judi"');
    console.log(users);
}

export const moodle = async () => {
    let fecha_now = new Date(); //Fecha Actual
    var mlSeconds = 24*60*60000;
    var newDateObj = new Date(fecha_now - mlSeconds);
    var groupName = "";
    var userjd = await pool.query(`SELECT * FROM request WHERE submitted_at BETWEEN "2023-01-01 00:00:00" AND "${newDateObj.toISOString()}" AND status = ""`);
    //console.log(userjd);
    if(userjd.length!=0){
        const usernamestr = userjd[0].firstname.substring(0,2)+userjd[0].lastname.substring(0,2)+ "-" +fecha_now.getTime().toString().substring(9,13);
            const username = usernamestr.toLowerCase();
            var mUser = { 
                username: username, 
                firstname: userjd[0].firstname, 
                lastname: userjd[0].lastname, 
                institution: userjd[0].institution, 
                country: userjd[0].country,
                role: userjd[0].role,
                course: userjd[0].course, 
                email: userjd[0].email, 
                phone: userjd[0].phone,
                campus_id: 0
            };

            var qUser = await queryMoodleUser(mUser.email); // consultamos este usuario en el moodle
            var data = qUser.data.split("<hr>");
            let response = JSON.parse(data[2]);
            var iC = enrollmentGroups.find(obj => obj.courseName === mUser.course);
            if(mUser.role == "Estudiante"){
                groupName = "PROGRAMA ESTUDIANTES 2023";
            } else {
                groupName = "PROGRAMA PROFESORES 2023";
            }
            var iG = iC.groups.find(obj => obj.groupName === groupName);
            var newEnrollment = {
                course_id: iC.courseId,
                user_email: mUser.email,
                role: mUser.role,
                course_group: iG.groupId
            }
            
            if(response.users.length != 0){ //Cuando el usuario ya esta registrado entonces lo matricula y lo añade al curso.
                var enrollment = await enrollMoodleuser(response.users[0].id, iC.courseId);
                var addToGroup = await addUserToMoodleGroup(response.users[0].id, iG.groupId);
                var insertEnrollDb = await pool.query('INSERT INTO enrollments set ?', [newEnrollment]);
                var updateReqDb = await pool.query(`UPDATE request SET status = "enrolled" WHERE id_ext="${userjd[0].id_ext}"`);
                return "usuario matriculado " + mUser.email;
            }
            else //Cuando el usuario no esta registrado entonces lo crea, lo matricula y lo agrega al grupo.
            {  
                var newUser = await createMoodleUser(mUser);
                var newUserData = newUser.data.split("<hr>");
                let newUserRes = JSON.parse(newUserData[2]);
                mUser.campus_id = newUserRes[0].id;
                var enrollment = await enrollMoodleuser(newUserRes[0].id, iC.courseId);
                var addToGroup = await addUserToMoodleGroup(newUserRes[0].id, iG.groupId);
                var insertuserDb = await pool.query('INSERT INTO users set ?', [mUser]);
                var insertEnrollDb = await pool.query('INSERT INTO enrollments set ?', [newEnrollment]);
                var updateReqDb = await pool.query(`UPDATE request SET status = "created + enrolled" WHERE email="${mUser.email}"`);
                return "usuario creado y matriculado " + mUser.email;
            }
    }else{
        return "No hay usuarios nuevos";
    }
}

async function getSpAccessToken() {
    const formData = new URLSearchParams();
    formData.append("grant_type", "refresh_token");
    formData.append("client_id", `${process.env.SP_CLIENT_ID}@${process.env.SP_TENANT_ID}`);
    formData.append("client_secret", process.env.SP_CLIENT_SECRET);
    formData.append("resource", `00000003-0000-0ff1-ce00-000000000000/${process.env.SP_TENANT_NAME}.sharepoint.com@${process.env.SP_TENANT_ID}`);
    formData.append("refresh_token", process.env.SP_REFRESHTOKEN);
    var config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: `https://accounts.accesscontrol.windows.net/${process.env.SP_TENANT_ID}/tokens/OAuth/2`,
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data : formData
      };
      let res = await axios(config)
      return res;
}

async function sendFileToSp(file, filename, spAccessToken) {
    var sitename =  'UNIVERSIDADES-ProyectoEducacional';
    var folderPath = 'General/7. Documentos aspirantes'
    var spurl = `https://${process.env.SP_TENANT_NAME}.sharepoint.com/sites/${sitename}/_api/web/GetFolderByServerRelativeURL('/sites/${sitename}/Shared Documents/${folderPath}/')/Files/add(url='${filename}',overwrite=true)`;
    var config = {
        method: 'post',
        url: spurl,
        headers: {
            'Authorization': `Bearer ${spAccessToken}`,
            'X-RequestDigest': '', 
            'Accept': 'application/json; odata=nometadata', 
            'Content-Type': 'application/pdf'
        },
        data : file
      };

    let res = await axios(config)
    return res;
}

async function queryMoodleUser(email){
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'core_user_get_users');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('criteria[0][key]', 'email');
    params.append('criteria[0][value]', email);
    var config = {
        method: 'get',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}

async function createMoodleUser(user) {
    //console.log(user);
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'core_user_create_users');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('users[0][username]', user.username);
    params.append('users[0][createpassword]', 1);
    params.append('users[0][firstname]', user.firstname);
    params.append('users[0][lastname]', user.lastname);
    params.append('users[0][institution]', user.institution);
    params.append('users[0][country]', user.country);
    params.append('users[0][phone1]', user.phone);
    params.append('users[0][email]', user.email);
    params.append('users[0][idnumber]', 'AUTOGENERATEDID002');
    params.append('users[0][description]', 'auto-generated');
    params.append('users[0][lang]', 'en');
    var config = {
        method: 'post',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}

async function enrollMoodleuser(userId, courseId){
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'enrol_manual_enrol_users');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('enrolments[0][roleid]', '5');
    params.append('enrolments[0][userid]', userId);
    params.append('enrolments[0][courseid]', courseId);
    params.append('enrolments[0][timestart]', '1672178173');
    params.append('enrolments[0][timeend]', '1678921849');
    params.append('enrolments[0][suspend]', '0'); //Este valor se puede usar para automatizar la extensión de matrícula

    var config = {
        method: 'post',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}

async function addUserToMoodleGroup(userId, groupid){
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'core_group_add_group_members');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('members[0][groupid]', groupid); //id del grupo al cual se espera incluir al usuario
    params.append('members[0][userid]', userId);

    var config = {
        method: 'post',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}


